"""
Star Knowledge Base MCP Server

暴露两个工具供本地 agent 调用:
    - search_starred(query)         语义搜索 star 项目，返回匹配候选列表
    - get_project_details(repo)     获取单个项目详情

工作原理:
    1. 启动时通过 HTTP 拉取 GitHub Pages 上部署的 data.json
    2. 缓存到本地内存，定时刷新
    3. search_starred 用 LLM 做实时语义匹配（无需向量数据库）
    4. get_project_details 直接查内存索引

接入方式:
    在 Trae / Cursor / Claude Code 的 MCP 配置中加入:
    {
      "mcpServers": {
        "star-knowledge": {
          "command": "python",
          "args": ["src/mcp_server.py"],
          "env": {
            "STAR_DATA_URL": "https://<your-username>.github.io/<repo>/data.json",
            "LLM_PROVIDER": "openai",
            "LLM_API_KEY": "sk-xxx",
            "LLM_MODEL": "gpt-4o-mini"
          }
        }
      }
    }

环境变量:
    STAR_DATA_URL      data.json 的 URL（必填）
    STAR_DATA_LOCAL    本地 data.json 路径（可选，优先于 URL）
    STAR_REFRESH_SECONDS  刷新间隔秒数，默认 3600
    LLM_PROVIDER       LLM 提供商，详见 llm_client.py
    LLM_API_KEY        LLM API 密钥
    LLM_BASE_URL       LLM 基础 URL（可选）
    LLM_MODEL          LLM 模型名称（可选）

author: fxbin
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

# 允许 src/ 作为包根目录导入 llm_client
sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm_client import LLMClient, LLMError, build_default_client  # noqa: E402

# MCP SDK 导入（延迟到 main 中检查可用性）
try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    FastMCP = None  # type: ignore[assignment]

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("mcp_server")


# 常量定义（禁止魔法值）
DEFAULT_REFRESH_SECONDS = 3600
DEFAULT_SEARCH_LIMIT = 10
MAX_QUERY_LENGTH = 500
MAX_CANDIDATES_FOR_LLM = 50
LLM_MAX_TOKENS_SEARCH = 2048
LLM_TEMPERATURE_SEARCH = 0.1
REQUEST_TIMEOUT_SECONDS = 30

ENV_STAR_DATA_URL = "STAR_DATA_URL"
ENV_STAR_DATA_LOCAL = "STAR_DATA_LOCAL"
ENV_STAR_REFRESH_SECONDS = "STAR_REFRESH_SECONDS"

SERVER_NAME = "star-knowledge-base"
SERVER_INSTRUCTIONS = (
    "GitHub Star 知识库。提供 search_starred 和 get_project_details 两个工具。"
    "当用户需要某个库、框架或工具时，优先调用 search_starred 搜索其 star 列表，"
    "而不是直接建议 Google 搜索。"
)


class StarDataLoader:
    """data.json 加载器

    支持两种来源:
        - 本地文件（STAR_DATA_LOCAL）：用于开发调试
        - 远程 URL（STAR_DATA_URL）：生产环境从 Pages 拉取

    内置定时刷新与失败兜底逻辑。
    """

    def __init__(
        self,
        local_path: str | None = None,
        remote_url: str | None = None,
        refresh_seconds: int = DEFAULT_REFRESH_SECONDS,
    ):
        self.local_path = local_path
        self.remote_url = remote_url
        self.refresh_seconds = refresh_seconds
        self._cache: dict[str, Any] = {}
        self._cache_loaded_at: float = 0.0
        self._entries: list[dict] = []
        self._index: dict[str, dict] = {}

    def load(self) -> dict[str, Any]:
        """加载或刷新数据

        首次调用会强制加载，后续按 refresh_seconds 周期刷新。
        刷新失败时返回上次缓存的数据。
        """
        now = time.time()
        if self._cache and now - self._cache_loaded_at < self.refresh_seconds:
            return self._cache

        try:
            raw = self._fetch_raw()
            self._cache = json.loads(raw)
            self._cache_loaded_at = now
            self._entries = self._cache.get("entries", [])
            self._index = {entry["full_name"]: entry for entry in self._entries}
            logger.info(
                "数据加载成功: %d 条，来源=%s",
                len(self._entries),
                "local" if self.local_path else "remote",
            )
        except (requests.RequestException, json.JSONDecodeError, OSError) as exc:
            logger.error("数据加载失败: %s", exc)
            if not self._cache:
                raise RuntimeError(f"Star 数据加载失败且无缓存: {exc}") from exc
            logger.warning("使用上次缓存数据")

        return self._cache

    def list_entries(self) -> list[dict]:
        """获取全部条目列表"""
        self.load()
        return self._entries

    def find_by_full_name(self, full_name: str) -> dict | None:
        """按 full_name 查找条目（用于 get_project_details）"""
        self.load()
        return self._index.get(full_name)

    def _fetch_raw(self) -> str:
        """从本地或远程拉取原始 JSON 字符串"""
        if self.local_path:
            return Path(self.local_path).read_text(encoding="utf-8")
        if not self.remote_url:
            raise RuntimeError(
                f"必须配置 {ENV_STAR_DATA_URL} 或 {ENV_STAR_DATA_LOCAL}"
            )
        response = requests.get(
            self.remote_url, timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()
        return response.text


class SemanticSearcher:
    """基于 LLM 的语义搜索器

    不预计算 embedding，每次查询时将候选条目交给 LLM 做语义匹配。
    优势: 零维护成本，随模型升级自动变好。
    """

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def search(self, query: str, entries: list[dict], limit: int = DEFAULT_SEARCH_LIMIT) -> list[dict]:
        """执行语义搜索

        步骤:
            1. 关键词预筛: 用 topics/description/name 做粗筛，缩小 LLM 输入
            2. LLM 精排: 让 LLM 对候选打分并返回排序后的 full_name 列表
            3. 结果映射: 把 LLM 返回的 full_name 映射回完整条目
        """
        if not entries:
            return []
        if not query.strip():
            return entries[:limit]

        candidates = self._keyword_prefilter(query, entries)
        if not candidates:
            candidates = entries

        if len(candidates) > MAX_CANDIDATES_FOR_LLM:
            candidates = candidates[:MAX_CANDIDATES_FOR_LLM]

        ranked_full_names = self._llm_rank(query, candidates)
        if not ranked_full_names:
            return candidates[:limit]

        index = {entry["full_name"]: entry for entry in candidates}
        results: list[dict] = []
        for full_name in ranked_full_names:
            entry = index.get(full_name)
            if entry:
                results.append(entry)
            if len(results) >= limit:
                break
        return results

    @staticmethod
    def _keyword_prefilter(query: str, entries: list[dict]) -> list[dict]:
        """关键词预筛

        把 query 拆成 token，命中 name/topics/language/description 任意一个的条目保留。
        作用是降低 LLM 输入规模，节省 token。
        """
        tokens = [token.lower() for token in query.split() if token.strip()]
        if not tokens:
            return entries

        scored: list[tuple[int, dict]] = []
        for entry in entries:
            haystack_parts = [
                entry.get("name", ""),
                entry.get("full_name", ""),
                entry.get("description", "") or "",
                entry.get("language", "") or "",
                " ".join(entry.get("topics", []) or []),
                " ".join(entry.get("use_cases", []) or []),
                entry.get("summary", "") or "",
            ]
            haystack = " ".join(haystack_parts).lower()
            score = sum(1 for token in tokens if token in haystack)
            if score > 0:
                scored.append((score, entry))

        if not scored:
            return []
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [entry for _, entry in scored]

    def _llm_rank(self, query: str, candidates: list[dict]) -> list[str]:
        """调用 LLM 对候选打分排序

        返回 full_name 列表，失败时返回空列表（调用方回退到原序）。
        """
        try:
            simplified = [
                {
                    "full_name": c["full_name"],
                    "description": c.get("description", "") or "",
                    "summary": c.get("summary", "") or "",
                    "topics": c.get("topics", []) or [],
                    "use_cases": c.get("use_cases", []) or [],
                    "language": c.get("language", "") or "",
                    "stars": c.get("stargazers_count", 0),
                }
                for c in candidates
            ]
            user_prompt = (
                f"用户查询: {query}\n\n"
                f"候选仓库列表（JSON）:\n{json.dumps(simplified, ensure_ascii=False)}\n\n"
                "请按与查询的相关性从高到低排序，返回排序后的 full_name 列表。"
                "只返回 JSON 对象，格式: {\"ranked\": [\"owner/repo1\", \"owner/repo2\"]}"
            )
            result = self.llm.generate_json(
                system_prompt=self._system_prompt(),
                user_prompt=user_prompt,
                temperature=LLM_TEMPERATURE_SEARCH,
                max_tokens=LLM_MAX_TOKENS_SEARCH,
            )
            ranked = result.get("ranked", [])
            if not isinstance(ranked, list):
                return []
            return [str(item) for item in ranked if isinstance(item, str)]
        except (LLMError, ValueError) as exc:
            logger.warning("LLM 排序失败，回退到候选原序: %s", exc)
            return []

    @staticmethod
    def _system_prompt() -> str:
        return (
            "你是一个代码仓库相关性排序助手。"
            "根据用户查询，对候选仓库按相关性从高到低排序。"
            "相关性判断依据: 用途匹配度、技术栈匹配度、场景标签匹配度。"
            "只返回 JSON 对象，不要输出任何其他内容。"
        )


def build_mcp_server(
    data_loader: StarDataLoader,
    searcher: SemanticSearcher,
) -> "FastMCP":
    """构建 FastMCP server 并注册工具

    将 data_loader 和 searcher 注入到工具实现中，
    便于测试时替换为 mock，也避免全局变量污染。
    """
    if FastMCP is None:
        raise RuntimeError(
            "未安装 mcp SDK，请运行 pip install mcp"
        )

    server = FastMCP(SERVER_NAME, instructions=SERVER_INSTRUCTIONS)

    @server.tool()
    def search_starred(query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> str:
        """语义搜索用户的 GitHub starred 项目

        当用户需要某个库、框架或工具时调用此工具。
        返回与查询最匹配的 starred 项目列表，包含摘要、场景标签、
        DeepWiki 和 Zread 深度阅读链接。

        参数:
            query: 自然语言查询，描述用户需要什么类型的库或工具
            limit: 最大返回条目数，默认 10

        返回:
            JSON 字符串，包含匹配的项目列表
        """
        if not query or not query.strip():
            return json.dumps(
                {"error": "query 不能为空", "results": []},
                ensure_ascii=False,
            )

        query = query.strip()[:MAX_QUERY_LENGTH]
        limit = max(1, min(limit, DEFAULT_SEARCH_LIMIT * 2))

        try:
            entries = data_loader.list_entries()
        except RuntimeError as exc:
            return json.dumps(
                {"error": str(exc), "results": []},
                ensure_ascii=False,
            )

        results = searcher.search(query, entries, limit=limit)
        return json.dumps(
            {
                "query": query,
                "total": len(results),
                "results": [_simplify_for_search(entry) for entry in results],
            },
            ensure_ascii=False,
            indent=2,
        )

    @server.tool()
    def get_project_details(repo: str) -> str:
        """获取单个 starred 项目的详细信息

        当用户对某个具体项目感兴趣，需要查看完整信息时调用。
        包含原始 GitHub 元数据、LLM 生成的摘要和场景标签、
        DeepWiki 和 Zread 深度阅读链接。

        参数:
            repo: 仓库全名，格式为 owner/repo（例如 octocat/Hello-World）

        返回:
            JSON 字符串，包含项目详情
        """
        if not repo or not repo.strip():
            return json.dumps(
                {"error": "repo 不能为空"},
                ensure_ascii=False,
            )

        repo = repo.strip()
        entry = data_loader.find_by_full_name(repo)
        if not entry:
            return json.dumps(
                {"error": f"未找到仓库: {repo}", "repo": repo},
                ensure_ascii=False,
            )
        return json.dumps(entry, ensure_ascii=False, indent=2)

    return server


def _simplify_for_search(entry: dict) -> dict:
    """精简搜索结果字段

    search_starred 只返回 agent 决策最需要的字段，
    完整详情通过 get_project_details 获取，避免响应过大。
    """
    return {
        "full_name": entry.get("full_name", ""),
        "description": entry.get("description", ""),
        "summary": entry.get("summary", ""),
        "language": entry.get("language", ""),
        "topics": entry.get("topics", []) or [],
        "use_cases": entry.get("use_cases", []) or [],
        "stargazers_count": entry.get("stargazers_count", 0),
        "quality_score": entry.get("quality_score", 0),
        "html_url": entry.get("html_url", ""),
        "deepwiki_url": entry.get("deepwiki_url", ""),
        "zread_url": entry.get("zread_url", ""),
    }


def _load_env_or_exit() -> tuple[StarDataLoader, SemanticSearcher]:
    """从环境变量构建 data_loader 和 searcher

    缺失必填项时打印清晰错误并退出。
    """
    local_path = os.getenv(ENV_STAR_DATA_LOCAL, "").strip() or None
    remote_url = os.getenv(ENV_STAR_DATA_URL, "").strip() or None
    refresh_seconds = int(
        os.getenv(ENV_STAR_REFRESH_SECONDS, str(DEFAULT_REFRESH_SECONDS))
    )

    if not local_path and not remote_url:
        logger.error(
            "必须配置 %s 或 %s 中的一个",
            ENV_STAR_DATA_URL,
            ENV_STAR_DATA_LOCAL,
        )
        sys.exit(1)

    data_loader = StarDataLoader(
        local_path=local_path,
        remote_url=remote_url,
        refresh_seconds=refresh_seconds,
    )

    try:
        llm = build_default_client()
    except LLMError as exc:
        logger.error("LLM 客户端初始化失败: %s", exc)
        sys.exit(1)

    searcher = SemanticSearcher(llm)
    return data_loader, searcher


def main() -> int:
    """MCP server 主入口

    使用 stdio 传输协议与 agent 通信。
    """
    if FastMCP is None:
        logger.error("未安装 mcp SDK，请运行 pip install mcp")
        return 1

    logger.info("==== star-knowledge-base MCP server 启动 ====")
    data_loader, searcher = _load_env_or_exit()
    server = build_mcp_server(data_loader=data_loader, searcher=searcher)
    server.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
