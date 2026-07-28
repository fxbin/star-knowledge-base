"""
GitHub Star 数据同步脚本

由 GitHub Actions 每日定时触发，执行以下流程:
    1. 调用 GitHub starred API 拉取用户所有 starred 仓库
    2. 为每个仓库生成 LLM 元数据（摘要、场景标签、质量评分）
    3. 为每个仓库附加 DeepWiki / Zread 深度阅读链接
    4. 输出 public/data.json 供 Pages 展示与 MCP server 读取

设计原则:
    - 零摩擦: 用户无需手动标注，元数据由 LLM 自动推断
    - 增量更新: 已有元数据缓存复用，避免重复消耗 LLM token
    - 容错: 单个仓库失败不影响整体流程

环境变量:
    GITHUB_TOKEN     GitHub Token（建议使用 Actions 内置的 GITHUB_TOKEN）
    GITHUB_USERNAME  目标用户名（必填）
    LLM_PROVIDER     LLM 提供商，详见 llm_client.py
    LLM_API_KEY      LLM API 密钥
    LLM_BASE_URL     LLM 基础 URL（可选）
    LLM_MODEL        LLM 模型名称（可选）
    FORCE_REFRESH    是否强制重新生成所有元数据，true 时忽略缓存

author: fxbin
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from llm_client import LLMClient, LLMError, build_default_client

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("sync_stars")


# 常量定义（禁止魔法值）
GITHUB_API_BASE = "https://api.github.com"
GITHUB_STARRED_PATH = "/users/{username}/starred"
GITHUB_README_PATH = "/repos/{owner}/{repo}/readme"

DEEPWIKI_URL_TEMPLATE = "https://deepwiki.com/{owner}/{repo}"
ZREAD_URL_TEMPLATE = "https://zread.ai/{owner}/{repo}"

PAGE_SIZE = 100
REQUEST_TIMEOUT_SECONDS = 30
RATE_LIMIT_WAIT_SECONDS = 60

CACHE_FILE_NAME = "metadata_cache.json"
OUTPUT_FILE_NAME = "data.json"
OUTPUT_DIR_NAME = "public"

MAX_REPOS_PER_RUN = 2000
LLM_BATCH_SIZE = 5
LLM_MAX_TOKENS_METADATA = 800

ENV_GITHUB_TOKEN = "GITHUB_TOKEN"
ENV_GITHUB_USERNAME = "GITHUB_USERNAME"
ENV_FORCE_REFRESH = "FORCE_REFRESH"

SCHEMA_VERSION = "1.0"
HEURISTIC_GENERATOR_NAME = "heuristic"

# 启发式质量评分阈值（按 star 数分级）
HEURISTIC_SCORE_TIER_5 = 10000
HEURISTIC_SCORE_TIER_4 = 1000
HEURISTIC_SCORE_TIER_3 = 100
HEURISTIC_SCORE_TIER_2 = 10
HEURISTIC_SUMMARY_MAX_CHARS = 80
HEURISTIC_USE_CASE_MAX_COUNT = 3
HEURISTIC_README_SUMMARY_CHARS = 80


@dataclass
class StarredRepo:
    """单个 starred 仓库原始数据

    仅保留 sync_stars 关注的字段，避免 GitHub API 返回的几十个字段污染代码。
    """

    full_name: str
    name: str
    owner: str
    html_url: str
    description: str | None
    language: str | None
    topics: list[str]
    stargazers_count: int
    forks_count: int
    open_issues_count: int
    pushed_at: str
    updated_at: str
    starred_at: str


@dataclass
class RepoMetadata:
    """LLM 推断的仓库元数据

    摘要、场景标签、质量评分构成 agent 推荐的核心信号。
    """

    summary: str
    use_cases: list[str]
    quality_score: int
    generated_at: str
    generator_model: str


@dataclass
class StarKnowledgeEntry:
    """data.json 中单个条目

    合并原始 star 数据、LLM 元数据、外部深度阅读链接，
    是 Pages 和 MCP server 共用的统一数据结构。
    """

    full_name: str
    name: str
    owner: str
    html_url: str
    description: str | None
    language: str | None
    topics: list[str]
    stargazers_count: int
    forks_count: int
    open_issues_count: int
    pushed_at: str
    starred_at: str
    summary: str
    use_cases: list[str]
    quality_score: int
    deepwiki_url: str
    zread_url: str
    metadata_generated_at: str
    metadata_generator_model: str

    def to_dict(self) -> dict:
        """转换为可序列化字典"""
        return {
            "full_name": self.full_name,
            "name": self.name,
            "owner": self.owner,
            "html_url": self.html_url,
            "description": self.description,
            "language": self.language,
            "topics": self.topics,
            "stargazers_count": self.stargazers_count,
            "forks_count": self.forks_count,
            "open_issues_count": self.open_issues_count,
            "pushed_at": self.pushed_at,
            "starred_at": self.starred_at,
            "summary": self.summary,
            "use_cases": self.use_cases,
            "quality_score": self.quality_score,
            "deepwiki_url": self.deepwiki_url,
            "zread_url": self.zread_url,
            "metadata_generated_at": self.metadata_generated_at,
            "metadata_generator_model": self.metadata_generator_model,
        }


@dataclass
class MetadataCache:
    """元数据缓存

    key 为 repo full_name，value 为 RepoMetadata。
    增量更新时复用已有元数据，节省 LLM token。
    """

    entries: dict[str, RepoMetadata] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "MetadataCache":
        """从磁盘加载缓存，文件不存在时返回空缓存"""
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            entries = {}
            for key, value in raw.items():
                entries[key] = RepoMetadata(
                    summary=value["summary"],
                    use_cases=value["use_cases"],
                    quality_score=value["quality_score"],
                    generated_at=value["generated_at"],
                    generator_model=value["generator_model"],
                )
            logger.info("加载元数据缓存: %d 条", len(entries))
            return cls(entries=entries)
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("缓存文件损坏，将重新生成: %s", exc)
            return cls()

    def save(self, path: Path) -> None:
        """持久化缓存到磁盘"""
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            key: {
                "summary": value.summary,
                "use_cases": value.use_cases,
                "quality_score": value.quality_score,
                "generated_at": value.generated_at,
                "generator_model": value.generator_model,
            }
            for key, value in self.entries.items()
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("元数据缓存已写入: %s (%d 条)", path, len(payload))

    def get(self, full_name: str) -> RepoMetadata | None:
        return self.entries.get(full_name)

    def put(self, full_name: str, metadata: RepoMetadata) -> None:
        self.entries[full_name] = metadata


class GitHubStarredClient:
    """GitHub starred API 封装

    处理分页、速率限制、README 拉取等细节。
    """

    def __init__(self, token: str, username: str):
        self.token = token
        self.username = username
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "star-knowledge-base/1.0",
            }
        )

    def fetch_starred(self) -> list[StarredRepo]:
        """拉取所有 starred 仓库

        自动分页，遇到速率限制会等待重试。
        """
        url = GITHUB_API_BASE + GITHUB_STARRED_PATH.format(username=self.username)
        all_repos: list[StarredRepo] = []
        page = 1

        while True:
            logger.info("拉取 starred 第 %d 页", page)
            response = self._request_with_retry(
                "GET", url, params={"page": page, "per_page": PAGE_SIZE}
            )
            items = response.json()
            if not items:
                break

            for item in items:
                repo = self._parse_starred_item(item)
                if repo:
                    all_repos.append(repo)

            if len(items) < PAGE_SIZE:
                break
            if len(all_repos) >= MAX_REPOS_PER_RUN:
                logger.warning("达到单次运行上限 %d，剩余仓库下次同步", MAX_REPOS_PER_RUN)
                break
            page += 1

        logger.info("共拉取 %d 个 starred 仓库", len(all_repos))
        return all_repos

    def fetch_readme_excerpt(self, owner: str, repo: str, max_chars: int = 2000) -> str:
        """拉取 README 摘要文本

        失败时返回空字符串，不阻断整体流程。
        """
        url = GITHUB_API_BASE + GITHUB_README_PATH.format(owner=owner, repo=repo)
        try:
            response = self._request_with_retry("GET", url)
            content = response.json().get("content", "")
            if not content:
                return ""
            import base64

            decoded = base64.b64decode(content).decode("utf-8", errors="ignore")
            return decoded[:max_chars]
        except Exception as exc:
            logger.debug("拉取 README 失败 %s/%s: %s", owner, repo, exc)
            return ""

    def _request_with_retry(self, method: str, url: str, **kwargs) -> requests.Response:
        """带速率限制处理的请求封装"""
        kwargs.setdefault("timeout", REQUEST_TIMEOUT_SECONDS)
        response = self.session.request(method, url, **kwargs)

        if response.status_code == 403 and "X-RateLimit-Remaining" in response.headers:
            remaining = response.headers.get("X-RateLimit-Remaining")
            if remaining == "0":
                reset_ts = int(response.headers.get("X-RateLimit-Reset", "0"))
                wait = max(reset_ts - int(time.time()), 1)
                logger.warning("触发 GitHub 速率限制，等待 %ds 后重试", wait)
                time.sleep(min(wait, RATE_LIMIT_WAIT_SECONDS))
                return self._request_with_retry(method, url, **kwargs)

        response.raise_for_status()
        return response

    @staticmethod
    def _parse_starred_item(item: dict) -> StarredRepo | None:
        """从 GitHub API 响应解析 StarredRepo"""
        try:
            full_name = item["full_name"]
            owner, name = full_name.split("/", 1)
            return StarredRepo(
                full_name=full_name,
                name=item["name"],
                owner=owner,
                html_url=item["html_url"],
                description=item.get("description"),
                language=item.get("language"),
                topics=item.get("topics", []) or [],
                stargazers_count=item.get("stargazers_count", 0),
                forks_count=item.get("forks_count", 0),
                open_issues_count=item.get("open_issues_count", 0),
                pushed_at=item.get("pushed_at", ""),
                updated_at=item.get("updated_at", ""),
                starred_at=item.get("starred_at", ""),
            )
        except (KeyError, ValueError) as exc:
            logger.warning("解析 starred 条目失败: %s", exc)
            return None


class MetadataGenerator:
    """元数据生成器

    双模式工作:
        - LLM 模式（推荐）: 配置了 LLM_API_KEY 时，调用 LLM 生成高质量摘要和场景标签
        - 启发式模式（零摩擦）: 未配置 LLM 时，用 GitHub API 原始数据启发式生成

    启发式规则:
        - summary: 优先 description，缺失时取 README 第一段，再缺失用 full_name
        - use_cases: topics 前 3 个 + language
        - quality_score: 按 star 数分级 1-5
    """

    def __init__(self, llm: LLMClient | None):
        self.llm = llm
        self.model_name = llm.config.model if llm else HEURISTIC_GENERATOR_NAME

    def generate(self, repo: StarredRepo, readme_excerpt: str) -> RepoMetadata:
        """为单个仓库生成元数据

        LLM 模式失败时自动降级到启发式，保证单点失败不影响整体同步。
        """
        if self.llm is None:
            return self._heuristic_metadata(repo, readme_excerpt)

        try:
            result = self.llm.generate_json(
                system_prompt=self._system_prompt(),
                user_prompt=self._user_prompt(repo, readme_excerpt),
                temperature=0.2,
                max_tokens=LLM_MAX_TOKENS_METADATA,
            )
            return RepoMetadata(
                summary=str(result.get("summary", "")).strip(),
                use_cases=[str(item) for item in result.get("use_cases", [])][:5],
                quality_score=self._clamp_quality_score(result.get("quality_score")),
                generated_at=datetime.now(timezone.utc).isoformat(),
                generator_model=self.model_name,
            )
        except (LLMError, ValueError) as exc:
            logger.warning("LLM 元数据生成失败 %s: %s，降级到启发式", repo.full_name, exc)
            return self._heuristic_metadata(repo, readme_excerpt)

    @staticmethod
    def _system_prompt() -> str:
        """系统提示词：约束 LLM 输出结构化 JSON"""
        return (
            "你是一个代码仓库元数据分析助手。根据用户提供的仓库信息，生成结构化的中文元数据。"
            "输出必须是合法的 JSON 对象，包含以下字段：\n"
            "- summary: 一句话摘要，不超过 80 个汉字，描述这个项目是做什么的\n"
            "- use_cases: 数组，列出 2-5 个典型适用场景，每个场景不超过 20 个字\n"
            "- quality_score: 整数 1-5，综合 star 数、活跃度、文档质量的评分\n"
            "不要输出任何 JSON 之外的内容。"
        )

    @staticmethod
    def _user_prompt(repo: StarredRepo, readme_excerpt: str) -> str:
        """用户提示词：拼装仓库上下文"""
        readme_block = readme_excerpt[:1500] if readme_excerpt else "（README 不可用）"
        return (
            f"仓库全名: {repo.full_name}\n"
            f"描述: {repo.description or '（无描述）'}\n"
            f"语言: {repo.language or '未知'}\n"
            f"Topics: {', '.join(repo.topics) if repo.topics else '无'}\n"
            f"Star 数: {repo.stargazers_count}\n"
            f"Fork 数: {repo.forks_count}\n"
            f"Open Issues: {repo.open_issues_count}\n"
            f"最近 push: {repo.pushed_at}\n"
            f"README 摘要:\n{readme_block}\n"
        )

    @staticmethod
    def _clamp_quality_score(value: Any) -> int:
        """将质量评分钳制到 1-5 区间"""
        try:
            score = int(value)
        except (TypeError, ValueError):
            return 3
        return max(1, min(5, score))

    @staticmethod
    def _heuristic_metadata(repo: StarredRepo, readme_excerpt: str) -> RepoMetadata:
        """启发式生成元数据（零摩擦模式，无需 LLM）

        规则:
            - summary: 优先 description；缺失时取 README 第一段非标题文本；
              再缺失用 full_name
            - use_cases: topics 前 3 个 + language（去重）
            - quality_score: 按 star 数分级 1-5
        """
        summary = _extract_heuristic_summary(repo, readme_excerpt)
        use_cases = _extract_heuristic_use_cases(repo)
        score = _compute_heuristic_quality_score(repo.stargazers_count)
        return RepoMetadata(
            summary=summary,
            use_cases=use_cases,
            quality_score=score,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generator_model=HEURISTIC_GENERATOR_NAME,
        )


def _extract_heuristic_summary(repo: StarredRepo, readme_excerpt: str) -> str:
    """从 description 或 README 提取启发式摘要"""
    if repo.description and repo.description.strip():
        return repo.description.strip()[:HEURISTIC_SUMMARY_MAX_CHARS]

    if readme_excerpt:
        for line in readme_excerpt.splitlines():
            text = line.strip().lstrip("#").strip()
            if text and not text.startswith(("!", "[", "-", "*")):
                return text[:HEURISTIC_README_SUMMARY_CHARS]

    return repo.full_name[:HEURISTIC_SUMMARY_MAX_CHARS]


def _extract_heuristic_use_cases(repo: StarredRepo) -> list[str]:
    """从 topics 和 language 提取启发式场景标签"""
    use_cases: list[str] = []
    for topic in repo.topics:
        if topic not in use_cases:
            use_cases.append(topic)
        if len(use_cases) >= HEURISTIC_USE_CASE_MAX_COUNT:
            break
    if repo.language and repo.language not in use_cases:
        use_cases.append(repo.language)
    return use_cases[:HEURISTIC_USE_CASE_MAX_COUNT]


def _compute_heuristic_quality_score(stargazers_count: int) -> int:
    """按 star 数分级计算启发式质量评分 1-5"""
    if stargazers_count >= HEURISTIC_SCORE_TIER_5:
        return 5
    if stargazers_count >= HEURISTIC_SCORE_TIER_4:
        return 4
    if stargazers_count >= HEURISTIC_SCORE_TIER_3:
        return 3
    if stargazers_count >= HEURISTIC_SCORE_TIER_2:
        return 2
    return 1


def build_entry(repo: StarredRepo, metadata: RepoMetadata) -> StarKnowledgeEntry:
    """合并原始数据、元数据、外部链接，构建最终条目"""
    return StarKnowledgeEntry(
        full_name=repo.full_name,
        name=repo.name,
        owner=repo.owner,
        html_url=repo.html_url,
        description=repo.description,
        language=repo.language,
        topics=repo.topics,
        stargazers_count=repo.stargazers_count,
        forks_count=repo.forks_count,
        open_issues_count=repo.open_issues_count,
        pushed_at=repo.pushed_at,
        starred_at=repo.starred_at,
        summary=metadata.summary,
        use_cases=metadata.use_cases,
        quality_score=metadata.quality_score,
        deepwiki_url=DEEPWIKI_URL_TEMPLATE.format(owner=repo.owner, repo=repo.name),
        zread_url=ZREAD_URL_TEMPLATE.format(owner=repo.owner, repo=repo.name),
        metadata_generated_at=metadata.generated_at,
        metadata_generator_model=metadata.generator_model,
    )


def write_output(entries: list[StarKnowledgeEntry], output_path: Path) -> None:
    """写入 public/data.json

    顶层结构包含 schema 版本、生成时间、用户名、条目列表，
    便于 MCP server 与 Pages 前端统一解析。
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(entries),
        "entries": [entry.to_dict() for entry in entries],
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("已写入 %s，共 %d 条", output_path, len(entries))


def main() -> int:
    """主入口

    返回 0 表示成功，非 0 表示失败（供 Actions 判断）。
    """
    start_time = time.time()
    logger.info("==== sync_stars 开始 ====")

    username = os.getenv(ENV_GITHUB_USERNAME, "").strip()
    if not username:
        logger.error("环境变量 %s 未配置", ENV_GITHUB_USERNAME)
        return 1
    token = os.getenv(ENV_GITHUB_TOKEN, "").strip()
    if not token:
        logger.error("环境变量 %s 未配置", ENV_GITHUB_TOKEN)
        return 1

    force_refresh = os.getenv(ENV_FORCE_REFRESH, "false").lower() == "true"

    project_root = Path(__file__).resolve().parent.parent
    output_dir = project_root / OUTPUT_DIR_NAME
    cache_path = project_root / ".cache" / CACHE_FILE_NAME
    output_path = output_dir / OUTPUT_FILE_NAME

    cache = MetadataCache.load(cache_path) if not force_refresh else MetadataCache()
    if force_refresh:
        logger.info("FORCE_REFRESH=true，忽略缓存重新生成所有元数据")

    github_client = GitHubStarredClient(token=token, username=username)
    try:
        repos = github_client.fetch_starred()
    except requests.RequestException as exc:
        logger.error("拉取 starred 数据失败: %s", exc)
        return 1

    if not repos:
        logger.warning("未拉取到任何 starred 仓库，可能是用户名错误或 star 列表为空")
        write_output([], output_path)
        return 0

    try:
        llm = build_default_client()
    except LLMError as exc:
        logger.error("LLM 客户端初始化失败: %s", exc)
        return 1
    if llm is None:
        logger.info("LLM 未配置，使用启发式模式生成元数据（零摩擦模式）")
    else:
        logger.info("LLM 已配置，使用 %s 增强元数据生成", llm.config.model)
    generator = MetadataGenerator(llm)

    entries: list[StarKnowledgeEntry] = []
    for index, repo in enumerate(repos, start=1):
        metadata = cache.get(repo.full_name)
        if metadata is None:
            readme_excerpt = github_client.fetch_readme_excerpt(repo.owner, repo.name)
            metadata = generator.generate(repo, readme_excerpt)
            cache.put(repo.full_name, metadata)
            logger.info("[%d/%d] 生成元数据: %s", index, len(repos), repo.full_name)
        else:
            logger.debug("[%d/%d] 命中缓存: %s", index, len(repos), repo.full_name)
        entries.append(build_entry(repo, metadata))

    write_output(entries, output_path)
    cache.save(cache_path)

    elapsed = time.time() - start_time
    logger.info("==== sync_stars 完成，耗时 %.1fs ====", elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
