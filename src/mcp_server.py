"""
Star Knowledge Base MCP Server

暴露三个工具供本地 agent 调用:
    - search_starred(...)           语义/关键词搜索 + 结构化筛选 star 项目
    - get_project_details(repo)     获取单个项目详情
    - list_facets(top_n)            查看语言、大类、Topic 分布与置顶列表

工作原理:
    1. 启动后按需拉取 GitHub Pages 上的 data.json（或读取 STAR_DATA_LOCAL）
    2. 缓存到本地内存，按 STAR_REFRESH_SECONDS 定时刷新
    3. search_starred 支持中英文分词、结构化过滤、以及可选的 LLM 语义精排
    4. get_project_details 支持大小写不敏感、GitHub URL 剥离与唯一短名匹配

环境变量:
    STAR_DATA_URL         data.json 的 URL（与 STAR_DATA_LOCAL 二选一）
    STAR_DATA_LOCAL       本地 data.json 路径（可选，优先于 URL）
    STAR_REFRESH_SECONDS  刷新间隔秒数，默认 3600
    LLM_PROVIDER          LLM 提供商，详见 llm_client.py
    LLM_API_KEY           LLM API 密钥（可选，不配则走关键词+结构化匹配）
    LLM_BASE_URL          LLM 基础 URL（可选）
    LLM_MODEL             LLM 模型名称（可选）

author: fxbin
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import requests

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment]

# 允许 src/ 作为包根目录导入 llm_client
SRC_DIR = str(Path(__file__).resolve().parent)
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

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

NO_LANGUAGE_SENTINELS = frozenset({"__none__", "none", "null", "无语言"})

CJK_GLUE_CHARS = frozenset({"的", "了", "和", "与", "或", "及", "在", "是", "有", "为"})
CJK_STOPWORDS = frozenset(
    {
        "一个",
        "一些",
        "用于",
        "用来",
        "可以",
        "能够",
        "如何",
        "怎么",
        "什么",
        "哪些",
        "推荐",
        "帮我",
        "寻找",
        "查找",
        "需要",
        "支持",
        "实现",
        "关于",
        "相关",
        "项目",
        "仓库",
        "代码",
        "那个",
        "这个",
    }
)

SERVER_NAME = "star-knowledge-base"
SERVER_INSTRUCTIONS = (
    "GitHub Star 知识库。提供 search_starred、get_project_details 和 list_facets 三个工具。"
    "当用户需要某个库、框架或工具时，先调用 search_starred 搜索其 star 列表"
    "（支持中英文关键词以及 language/topic/category/min_stars/include_archived/sort_by 结构化筛选），"
    "也可先调用 list_facets 了解技术栈分布，而不是直接建议 Google 搜索。"
)


def tokenize_query(query: str) -> list[str]:
    """将中英文混合查询拆分为检索 token

    规则:
        - ASCII 词保留（含 c++ / c# / node.js 等技术标识），若含连字符或斜杠额外补充子词
        - 中文按连接虚词切分片段，片段抽取完整词及 2 字滑窗词元，过滤无意义虚词
    """
    lowered = query.strip().lower()
    if not lowered:
        return []

    tokens: list[str] = []
    seen: set[str] = set()

    def _add(tok: str) -> None:
        cleaned = tok.strip(".")
        if not cleaned or cleaned in seen:
            return
        seen.add(cleaned)
        tokens.append(cleaned)

    for ascii_tok in re.findall(r"[a-z0-9][a-z0-9_+#.-]*", lowered):
        _add(ascii_tok)
        if "-" in ascii_tok or "/" in ascii_tok:
            for part in re.split(r"[-/]+", ascii_tok):
                if len(part) >= 2:
                    _add(part)

    for cjk_run in re.findall(r"[\u4e00-\u9fff]+", lowered):
        segments = re.split(f"[{''.join(CJK_GLUE_CHARS)}]+", cjk_run)
        for seg in segments:
            if not seg:
                continue
            if len(seg) <= 2:
                if seg not in CJK_STOPWORDS:
                    _add(seg)
            else:
                if len(seg) <= 8 and seg not in CJK_STOPWORDS:
                    _add(seg)
                for idx in range(len(seg) - 1):
                    bigram = seg[idx : idx + 2]
                    if bigram not in CJK_STOPWORDS:
                        _add(bigram)

    return tokens


class StarDataLoader:
    """data.json 加载器

    支持两种来源:
        - 本地文件（STAR_DATA_LOCAL）：用于开发调试
        - 远程 URL（STAR_DATA_URL）：生产环境从 Pages 拉取

    内置定时刷新、大小写不敏感索引与失败兜底逻辑。
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
        self._index_lower: dict[str, dict] = {}
        self._name_index: dict[str, list[dict]] = {}

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
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise json.JSONDecodeError("顶层必须是 JSON 对象", raw, 0)
            self._cache = parsed
            self._cache_loaded_at = now
            entries = [
                e for e in (self._cache.get("entries") or [])
                if isinstance(e, dict) and e.get("full_name")
            ]
            self._entries = entries
            self._index = {}
            self._index_lower = {}
            self._name_index = {}
            for entry in entries:
                full_name = str(entry["full_name"])
                self._index[full_name] = entry
                self._index_lower[full_name.lower()] = entry
                short_name = str(entry.get("name") or full_name.split("/")[-1]).lower()
                self._name_index.setdefault(short_name, []).append(entry)

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

    def get_generated_at(self) -> str:
        """获取数据生成时间"""
        self.load()
        return str(self._cache.get("generated_at") or "")

    def find_by_full_name(self, repo: str) -> dict | None:
        """按 full_name 查找条目（支持大小写不敏感、GitHub URL 剥离、唯一短名匹配）"""
        self.load()
        cleaned = repo.strip()
        for prefix in ("https://github.com/", "http://github.com/"):
            if cleaned.lower().startswith(prefix):
                cleaned = cleaned[len(prefix) :]
                break
        cleaned = cleaned.strip("/")
        if cleaned.lower().endswith(".git"):
            cleaned = cleaned[:-4]

        parts = [p for p in cleaned.split("/") if p]
        if not parts:
            return None

        if len(parts) >= 2:
            full_name = f"{parts[0]}/{parts[1]}"
            return self._index.get(full_name) or self._index_lower.get(full_name.lower())

        matches = self._name_index.get(parts[0].lower(), [])
        if len(matches) == 1:
            return matches[0]
        return None

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
    """语义搜索器

    双模式工作:
        - LLM 模式（推荐）: 关键词相关性打分排序后取前 50 候选 + LLM 语义精排
        - 关键词模式（零摩擦）: 未配置 LLM 时，按中英文分词与字段权重排序返回
    """

    def __init__(self, llm: LLMClient | None):
        self.llm = llm

    def search(
        self,
        query: str,
        entries: list[dict],
        limit: int = DEFAULT_SEARCH_LIMIT,
    ) -> list[dict]:
        """执行搜索

        重要语义:
            - 未命中任何关键词时直接返回 []，绝不返回无关仓库
            - 先按相关度 + 质量分 + star 数排序，再截取前 MAX_CANDIDATES_FOR_LLM 条给 LLM 精排
        """
        if not entries:
            return []
        if not query.strip():
            return entries[:limit]

        scored_candidates = self._keyword_score(query, entries)
        if not scored_candidates:
            return []

        scored_candidates.sort(
            key=lambda pair: (
                pair[0],
                int(pair[1].get("quality_score") or 0),
                int(pair[1].get("stargazers_count") or 0),
            ),
            reverse=True,
        )

        if self.llm is None:
            return [entry for _, entry in scored_candidates[:limit]]

        candidates = [entry for _, entry in scored_candidates[:MAX_CANDIDATES_FOR_LLM]]
        ranked_full_names = self._llm_rank(query, candidates)
        if not ranked_full_names:
            return candidates[:limit]

        index = {entry["full_name"]: entry for entry in candidates}
        index_lower = {entry["full_name"].lower(): entry for entry in candidates}
        results: list[dict] = []
        seen: set[str] = set()
        for full_name in ranked_full_names:
            entry = index.get(full_name) or index_lower.get(full_name.lower())
            if entry and entry["full_name"] not in seen:
                seen.add(entry["full_name"])
                results.append(entry)
            if len(results) >= limit:
                break
        return results if results else candidates[:limit]

    @staticmethod
    def _keyword_score(query: str, entries: list[dict]) -> list[tuple[int, dict]]:
        """中英文关键词匹配并按字段权重评分"""
        tokens = tokenize_query(query)
        raw_phrase = query.strip().lower()
        if not tokens:
            return []

        scored: list[tuple[int, dict]] = []
        for entry in entries:
            name = (entry.get("name", "") or "").lower()
            full_name = (entry.get("full_name", "") or "").lower()
            description = (entry.get("description", "") or "").lower()
            language = (entry.get("language", "") or "").lower()
            category = (entry.get("category", "") or "").lower()
            topics = " ".join(entry.get("topics", []) or []).lower()
            use_cases = " ".join(entry.get("use_cases", []) or []).lower()
            summary = (entry.get("summary", "") or "").lower()
            note = (entry.get("note", "") or "").lower()

            score = 0
            matched_tokens = 0
            for token in tokens:
                token_hit = False
                if token in name or token in full_name:
                    score += 4
                    token_hit = True
                if token in topics or token in use_cases or token in category:
                    score += 3
                    token_hit = True
                if token in summary or token in note:
                    score += 2
                    token_hit = True
                if token in description or token in language:
                    score += 1
                    token_hit = True
                if token_hit:
                    matched_tokens += 1

            if score > 0:
                score += matched_tokens * 3
                if len(raw_phrase) >= 2 and (
                    raw_phrase in full_name
                    or raw_phrase in summary
                    or raw_phrase in description
                ):
                    score += 4
                if entry.get("pinned"):
                    score += 1
                scored.append((score, entry))

        return scored

    def _llm_rank(self, query: str, candidates: list[dict]) -> list[str]:
        """调用 LLM 对候选打分排序"""
        try:
            simplified = [
                {
                    "full_name": c["full_name"],
                    "description": c.get("description", "") or "",
                    "summary": c.get("summary", "") or "",
                    "category": c.get("category", "") or "",
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


def _filter_entries(
    entries: list[dict],
    language: str = "",
    topic: str = "",
    category: str = "",
    min_stars: int = 0,
    include_archived: bool = True,
) -> list[dict]:
    """按结构化条件过滤仓库列表"""
    lang_filter = language.strip().lower()
    topic_filter = topic.strip().lower()
    cat_filter = category.strip().lower()

    result = entries
    if lang_filter:
        if lang_filter in NO_LANGUAGE_SENTINELS:
            result = [e for e in result if not (e.get("language") or "").strip()]
        else:
            result = [
                e for e in result
                if (e.get("language") or "").strip().lower() == lang_filter
            ]

    if topic_filter:
        result = [
            e for e in result
            if any(
                topic_filter == str(t).lower() or topic_filter in str(t).lower()
                for t in (e.get("topics") or [])
            )
        ]

    if cat_filter:
        result = [
            e for e in result
            if cat_filter in (e.get("category") or "").strip().lower()
        ]

    if min_stars > 0:
        result = [
            e for e in result
            if int(e.get("stargazers_count") or 0) >= min_stars
        ]

    if not include_archived:
        result = [e for e in result if not bool(e.get("archived", False))]

    return result


def _sort_entries(entries: list[dict], sort_by: str) -> list[dict]:
    """按指定字段降序排列"""
    key = sort_by.strip().lower()
    if key in ("stars", "stargazers_count"):
        return sorted(
            entries,
            key=lambda e: int(e.get("stargazers_count") or 0),
            reverse=True,
        )
    if key in ("updated", "pushed_at"):
        return sorted(
            entries,
            key=lambda e: str(e.get("pushed_at") or ""),
            reverse=True,
        )
    if key in ("starred", "starred_at"):
        return sorted(
            entries,
            key=lambda e: str(e.get("starred_at") or ""),
            reverse=True,
        )
    if key in ("score", "quality_score"):
        return sorted(
            entries,
            key=lambda e: (
                int(e.get("quality_score") or 0),
                int(e.get("stargazers_count") or 0),
            ),
            reverse=True,
        )
    return sorted(
        entries,
        key=lambda e: (
            1 if e.get("pinned") else 0,
            int(e.get("quality_score") or 0),
            int(e.get("stargazers_count") or 0),
        ),
        reverse=True,
    )


def build_mcp_server(
    data_loader: StarDataLoader,
    searcher: SemanticSearcher,
) -> "FastMCP":
    """构建 FastMCP server 并注册工具"""
    if FastMCP is None:
        raise RuntimeError(
            "未安装 mcp SDK，请运行 pip install mcp"
        )

    server = FastMCP(SERVER_NAME, instructions=SERVER_INSTRUCTIONS)

    @server.tool()
    def search_starred(
        query: str = "",
        limit: int = DEFAULT_SEARCH_LIMIT,
        language: str = "",
        topic: str = "",
        category: str = "",
        min_stars: int = 0,
        include_archived: bool = True,
        sort_by: str = "relevance",
    ) -> str:
        """语义与结构化搜索用户的 GitHub starred 项目

        当用户需要某个库、框架或工具时调用此工具。
        支持同时传入自然语言查询（建议附带英文关键词）与结构化过滤参数。

        参数:
            query: 搜索词（可为空，仅按过滤条件浏览时可留空）
            limit: 最大返回条目数，默认 10（范围 1-20）
            language: 按编程语言过滤（传 "__none__" 可筛选无语言文档类仓库）
            topic: 按 topic 标签过滤
            category: 按规范大类过滤（如 AI/Agent、后端/框架、前端/UI、开发工具等）
            min_stars: 最小 star 数过滤
            include_archived: 是否包含已归档仓库，默认 True
            sort_by: 排序方式：relevance（默认）/ stars / updated / starred / score

        返回:
            JSON 字符串，包含 matched 标记、筛选条件及匹配项目列表
        """
        query_clean = (query or "").strip()[:MAX_QUERY_LENGTH]
        has_filters = bool(
            language.strip()
            or topic.strip()
            or category.strip()
            or min_stars > 0
            or not include_archived
        )
        if not query_clean and not has_filters:
            return json.dumps(
                {"error": "query 和过滤条件不能同时为空", "matched": False, "total": 0, "results": []},
                ensure_ascii=False,
            )

        limit = max(1, min(limit, DEFAULT_SEARCH_LIMIT * 2))

        try:
            entries = data_loader.list_entries()
        except RuntimeError as exc:
            return json.dumps(
                {"error": str(exc), "matched": False, "total": 0, "results": []},
                ensure_ascii=False,
            )

        filtered = _filter_entries(
            entries,
            language=language,
            topic=topic,
            category=category,
            min_stars=min_stars,
            include_archived=include_archived,
        )

        sort_key = (sort_by or "relevance").strip().lower()
        if query_clean and sort_key == "relevance":
            results = searcher.search(query_clean, filtered, limit=limit)
        else:
            if query_clean:
                scored = searcher._keyword_score(query_clean, filtered)
                filtered = [entry for _, entry in scored]
            results = _sort_entries(filtered, sort_key)[:limit]

        active_filters = {
            k: v
            for k, v in {
                "language": language.strip(),
                "topic": topic.strip(),
                "category": category.strip(),
                "min_stars": min_stars if min_stars > 0 else None,
                "include_archived": include_archived if not include_archived else None,
            }.items()
            if v is not None and v != ""
        }

        return json.dumps(
            {
                "query": query_clean,
                "filters": active_filters,
                "sort_by": sort_key,
                "matched": len(results) > 0,
                "total": len(results),
                "results": [_simplify_for_search(entry) for entry in results],
            },
            ensure_ascii=False,
            indent=2,
        )

    @server.tool()
    def get_project_details(repo: str) -> str:
        """获取单个 starred 项目的详细信息

        支持传入 owner/repo（大小写不敏感）、GitHub 仓库 URL，或唯一仓库短名。
        """
        if not repo or not repo.strip():
            return json.dumps(
                {"error": "repo 不能为空"},
                ensure_ascii=False,
            )

        repo_clean = repo.strip()
        try:
            entry = data_loader.find_by_full_name(repo_clean)
        except RuntimeError as exc:
            return json.dumps(
                {"error": str(exc), "repo": repo_clean},
                ensure_ascii=False,
            )

        if not entry:
            return json.dumps(
                {"error": f"未找到仓库: {repo_clean}", "repo": repo_clean},
                ensure_ascii=False,
            )
        return json.dumps(entry, ensure_ascii=False, indent=2)

    @server.tool()
    def list_facets(top_n: int = 20) -> str:
        """汇总用户 star 知识库的语言、规范大类、高频 Topic 分布及置顶项目

        帮助 agent 在检索前先了解知识库的技术栈构成与可用过滤值。
        """
        top_n = max(1, min(top_n, 100))
        try:
            entries = data_loader.list_entries()
            generated_at = data_loader.get_generated_at()
        except RuntimeError as exc:
            return json.dumps(
                {"error": str(exc)},
                ensure_ascii=False,
            )

        lang_counts: Counter[str] = Counter()
        category_counts: Counter[str] = Counter()
        topic_counts: Counter[str] = Counter()
        archived_count = 0
        pinned: list[str] = []

        for entry in entries:
            lang = (entry.get("language") or "").strip() or "__none__"
            lang_counts[lang] += 1
            cat = (entry.get("category") or "").strip() or "未分类"
            category_counts[cat] += 1
            for t in entry.get("topics") or []:
                if t:
                    topic_counts[str(t)] += 1
            if entry.get("archived"):
                archived_count += 1
            if entry.get("pinned"):
                pinned.append(str(entry["full_name"]))

        return json.dumps(
            {
                "total": len(entries),
                "generated_at": generated_at,
                "archived_count": archived_count,
                "languages": [
                    {"name": name, "count": count}
                    for name, count in lang_counts.most_common(top_n)
                ],
                "categories": [
                    {"name": name, "count": count}
                    for name, count in category_counts.most_common()
                ],
                "topics": [
                    {"name": name, "count": count}
                    for name, count in topic_counts.most_common(top_n)
                ],
                "pinned": pinned,
            },
            ensure_ascii=False,
            indent=2,
        )

    return server


def _simplify_for_search(entry: dict) -> dict:
    """精简搜索结果字段，包含 agent 判断是否推荐的关键信号"""
    return {
        "full_name": entry.get("full_name", ""),
        "description": entry.get("description", ""),
        "summary": entry.get("summary", ""),
        "language": entry.get("language", ""),
        "category": entry.get("category", ""),
        "topics": entry.get("topics", []) or [],
        "use_cases": entry.get("use_cases", []) or [],
        "stargazers_count": entry.get("stargazers_count", 0),
        "quality_score": entry.get("quality_score", 0),
        "archived": bool(entry.get("archived", False)),
        "homepage": entry.get("homepage", "") or "",
        "license": entry.get("license", "") or "",
        "pushed_at": entry.get("pushed_at", "") or "",
        "starred_at": entry.get("starred_at", "") or "",
        "pinned": bool(entry.get("pinned", False)),
        "note": entry.get("note", "") or "",
        "html_url": entry.get("html_url", ""),
        "deepwiki_url": entry.get("deepwiki_url", ""),
        "zread_url": entry.get("zread_url", ""),
    }


def _parse_refresh_seconds() -> int:
    raw = os.getenv(ENV_STAR_REFRESH_SECONDS, "").strip()
    if not raw:
        return DEFAULT_REFRESH_SECONDS
    try:
        value = int(raw)
        if value <= 0:
            logger.warning("%s=%r 必须大于 0，使用默认值 %d", ENV_STAR_REFRESH_SECONDS, raw, DEFAULT_REFRESH_SECONDS)
            return DEFAULT_REFRESH_SECONDS
        return value
    except ValueError:
        logger.warning("%s=%r 非法，使用默认值 %d", ENV_STAR_REFRESH_SECONDS, raw, DEFAULT_REFRESH_SECONDS)
        return DEFAULT_REFRESH_SECONDS


def _load_env_or_exit() -> tuple[StarDataLoader, SemanticSearcher]:
    """从环境变量构建 data_loader 和 searcher"""
    local_path = os.getenv(ENV_STAR_DATA_LOCAL, "").strip() or None
    remote_url = os.getenv(ENV_STAR_DATA_URL, "").strip() or None
    refresh_seconds = _parse_refresh_seconds()

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

    llm = build_default_client()
    if llm is None:
        logger.info("LLM 未配置，search_starred 将使用关键词+结构化匹配模式（零摩擦模式）")
    else:
        logger.info("LLM 已配置: %s，search_starred 将使用 LLM 语义精排", llm.config.model)

    searcher = SemanticSearcher(llm)
    return data_loader, searcher


def main() -> int:
    """MCP server 主入口"""
    if FastMCP is None:
        logger.error("未安装 mcp SDK，请运行 pip install mcp")
        return 1

    project_root = Path(__file__).resolve().parent.parent
    if load_dotenv is not None:
        env_file = project_root / ".env"
        if env_file.exists():
            load_dotenv(env_file)

    logger.info("==== star-knowledge-base MCP server 启动 ====")
    data_loader, searcher = _load_env_or_exit()
    server = build_mcp_server(data_loader=data_loader, searcher=searcher)
    server.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
