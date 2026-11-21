"""
GitHub Star 数据同步脚本

由 GitHub Actions 每日定时触发，执行以下流程:
    1. 调用 GitHub starred API 拉取用户所有 starred 仓库（含 starred_at、archived、homepage、license）
    2. 加载已有元数据缓存与 gh-pages 上期 data.json 种子，避免重复拉取和重复消耗 LLM token
    3. 为新增或需要升级的仓库生成元数据（摘要、场景标签、规范大类、质量评分）
    4. 为每个仓库附加 DeepWiki / Zread 深度阅读链接，并合并可选的个人 notes.json
    5. 输出 public/data.json 供 Pages 展示与 MCP server 读取

设计原则:
    - 零摩擦: 用户无需手动标注，元数据由 LLM 或启发式规则自动生成
    - 增量更新: 复用缓存与上期线上数据，启发式条目在配置 LLM 后自动升级
    - 容错: 单个仓库失败不影响整体流程，且 LLM 降级结果不污染缓存

环境变量:
    GITHUB_TOKEN         GitHub Token（建议使用 Actions 内置的 GITHUB_TOKEN）
    GITHUB_USERNAME      目标用户名（必填）
    LLM_PROVIDER         LLM 提供商，详见 llm_client.py
    LLM_API_KEY          LLM API 密钥
    LLM_BASE_URL         LLM 基础 URL（可选）
    LLM_MODEL            LLM 模型名称（可选）
    LLM_CONCURRENCY      LLM 并发线程数，默认 3（上限 8）
    LLM_MAX_NEW_PER_RUN  单次运行最多用 LLM 处理的新仓库数，0 表示不限
    FORCE_REFRESH        是否强制重新生成所有元数据，true 时忽略缓存

author: fxbin
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment]

SRC_DIR = str(Path(__file__).resolve().parent)
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from llm_client import LLMClient, LLMError, build_default_client  # noqa: E402

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
GITHUB_STAR_ACCEPT = "application/vnd.github.star+json"

DEEPWIKI_URL_TEMPLATE = "https://deepwiki.com/{owner}/{repo}"
ZREAD_URL_TEMPLATE = "https://zread.ai/{owner}/{repo}"

PAGE_SIZE = 100
REQUEST_TIMEOUT_SECONDS = 30
RATE_LIMIT_WAIT_SECONDS = 60
MAX_GITHUB_RETRIES = 4
RETRYABLE_HTTP_STATUS = frozenset({500, 502, 503, 504})

CACHE_FILE_NAME = "metadata_cache.json"
PREVIOUS_DATA_FILE_NAME = "previous_data.json"
NOTES_FILE_NAME = "notes.json"
OUTPUT_FILE_NAME = "data.json"
OUTPUT_DIR_NAME = "public"

MAX_REPOS_PER_RUN = 2000
LLM_MAX_TOKENS_METADATA = 800
DEFAULT_LLM_CONCURRENCY = 3
MAX_LLM_CONCURRENCY = 8

ENV_GITHUB_TOKEN = "GITHUB_TOKEN"
ENV_GITHUB_USERNAME = "GITHUB_USERNAME"
ENV_FORCE_REFRESH = "FORCE_REFRESH"
ENV_LLM_CONCURRENCY = "LLM_CONCURRENCY"
ENV_LLM_MAX_NEW_PER_RUN = "LLM_MAX_NEW_PER_RUN"

SCHEMA_VERSION = "1.1"
HEURISTIC_GENERATOR_NAME = "heuristic"

CATEGORIES = (
    "AI/Agent",
    "后端/框架",
    "前端/UI",
    "开发工具",
    "数据/存储",
    "运维/安全",
    "学习/资源",
    "其他",
)
DEFAULT_CATEGORY = "其他"

# 启发式质量评分阈值（按 star 数分级）
HEURISTIC_SCORE_TIER_5 = 10000
HEURISTIC_SCORE_TIER_4 = 1000
HEURISTIC_SCORE_TIER_3 = 100
HEURISTIC_SCORE_TIER_2 = 10
HEURISTIC_SUMMARY_MAX_CHARS = 80
HEURISTIC_USE_CASE_MAX_COUNT = 3
HEURISTIC_README_SUMMARY_CHARS = 80

# 启发式分类关键词表（按优先级匹配）
CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "学习/资源",
        (
            "awesome",
            "roadmap",
            "interview",
            "tutorial",
            "course",
            "book",
            "books",
            "cheatsheet",
            "cheat-sheet",
            "curated",
            "study",
            "guide",
            "教程",
            "资料",
            "面试",
            "书籍",
            "指南",
            "学习",
        ),
    ),
    (
        "AI/Agent",
        (
            "llm",
            "agent",
            "agents",
            "mcp",
            "rag",
            "langchain",
            "langgraph",
            "openai",
            "anthropic",
            "claude",
            "gemini",
            "gpt",
            "embedding",
            "vector",
            "transformer",
            "pytorch",
            "tensorflow",
            "diffusion",
            "whisper",
            "tts",
            "vlm",
            "ai-agent",
            "generative-ai",
            "machine-learning",
            "deep-learning",
            "nlp",
            "ollama",
            "vllm",
            "大模型",
            "智能体",
            "机器学习",
        ),
    ),
    (
        "前端/UI",
        (
            "react",
            "vue",
            "svelte",
            "nextjs",
            "next.js",
            "nuxt",
            "tailwind",
            "css",
            "html",
            "ui",
            "component",
            "canvas",
            "webgl",
            "threejs",
            "vite",
            "frontend",
            "electron",
            "flutter",
            "swiftui",
            "chrome-extension",
            "browser-extension",
            "前端",
            "组件库",
            "界面",
        ),
    ),
    (
        "数据/存储",
        (
            "database",
            "sql",
            "postgres",
            "postgresql",
            "mysql",
            "sqlite",
            "redis",
            "mongodb",
            "clickhouse",
            "orm",
            "prisma",
            "drizzle",
            "elasticsearch",
            "kafka",
            "flink",
            "spark",
            "duckdb",
            "etl",
            "pandas",
            "数据库",
            "存储",
        ),
    ),
    (
        "运维/安全",
        (
            "docker",
            "kubernetes",
            "k8s",
            "helm",
            "terraform",
            "ansible",
            "ci-cd",
            "github-actions",
            "nginx",
            "proxy",
            "vpn",
            "prometheus",
            "grafana",
            "monitoring",
            "logging",
            "security",
            "oauth",
            "jwt",
            "pentest",
            "运维",
            "监控",
            "安全",
            "容器",
        ),
    ),
    (
        "开发工具",
        (
            "cli",
            "terminal",
            "shell",
            "vim",
            "neovim",
            "vscode",
            "ide",
            "linter",
            "formatter",
            "debugger",
            "testing",
            "benchmark",
            "git",
            "bundler",
            "compiler",
            "devtools",
            "sdk",
            "scraper",
            "crawler",
            "脚手架",
            "命令行",
            "调试",
            "爬虫",
        ),
    ),
    (
        "后端/框架",
        (
            "spring",
            "spring-boot",
            "spring-cloud",
            "fastapi",
            "django",
            "flask",
            "express",
            "nestjs",
            "gin",
            "fiber",
            "actix",
            "grpc",
            "graphql",
            "microservice",
            "rpc",
            "gateway",
            "backend",
            "server",
            "workflow",
            "后端",
            "微服务",
            "网关",
        ),
    ),
)

LANGUAGE_CATEGORY_MAP: dict[str, str] = {
    "Java": "后端/框架",
    "Go": "后端/框架",
    "Rust": "后端/框架",
    "C#": "后端/框架",
    "PHP": "后端/框架",
    "Ruby": "后端/框架",
    "Kotlin": "后端/框架",
    "Scala": "后端/框架",
    "Elixir": "后端/框架",
    "TypeScript": "前端/UI",
    "JavaScript": "前端/UI",
    "CSS": "前端/UI",
    "HTML": "前端/UI",
    "Vue": "前端/UI",
    "Svelte": "前端/UI",
    "Dart": "前端/UI",
    "Swift": "前端/UI",
    "Shell": "运维/安全",
    "Dockerfile": "运维/安全",
    "HCL": "运维/安全",
    "Makefile": "运维/安全",
    "SQL": "数据/存储",
    "PLpgSQL": "数据/存储",
    "Jupyter Notebook": "AI/Agent",
}


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
    archived: bool = False
    homepage: str = ""
    license: str = ""


@dataclass
class RepoMetadata:
    """LLM 或启发式推断的仓库元数据

    摘要、场景标签、大类、质量评分构成检索与推荐的核心信号。
    """

    summary: str
    use_cases: list[str]
    quality_score: int
    generated_at: str
    generator_model: str
    category: str = ""


@dataclass
class StarKnowledgeEntry:
    """data.json 中单个条目

    合并原始 star 数据、LLM 元数据、外部深度阅读链接与可选个人备注，
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
    archived: bool = False
    homepage: str = ""
    license: str = ""
    category: str = ""
    pinned: bool = False
    note: str = ""

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
            "archived": self.archived,
            "homepage": self.homepage,
            "license": self.license,
            "category": self.category,
            "summary": self.summary,
            "use_cases": self.use_cases,
            "quality_score": self.quality_score,
            "deepwiki_url": self.deepwiki_url,
            "zread_url": self.zread_url,
            "pinned": self.pinned,
            "note": self.note,
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
        """从磁盘缓存文件加载，文件不存在或损坏时返回空缓存"""
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                return cls()
            entries = {}
            for key, value in raw.items():
                if not isinstance(value, dict):
                    continue
                entries[key] = RepoMetadata(
                    summary=str(value["summary"]),
                    use_cases=list(value["use_cases"]),
                    quality_score=int(value["quality_score"]),
                    generated_at=str(value["generated_at"]),
                    generator_model=str(value["generator_model"]),
                    category=str(value.get("category", "") or ""),
                )
            logger.info("加载元数据缓存: %d 条", len(entries))
            return cls(entries=entries)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError, OSError) as exc:
            logger.warning("缓存文件损坏，将重新生成: %s", exc)
            return cls()

    @classmethod
    def load_from_data_json(cls, path: Path) -> "MetadataCache":
        """从上期产出的 data.json（如 gh-pages 上的 data.json）提取缓存种子"""
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            items = raw.get("entries", []) if isinstance(raw, dict) else []
            entries: dict[str, RepoMetadata] = {}
            for item in items:
                if not isinstance(item, dict):
                    continue
                full_name = item.get("full_name")
                summary = item.get("summary")
                if not full_name or not summary:
                    continue
                entries[str(full_name)] = RepoMetadata(
                    summary=str(summary),
                    use_cases=list(item.get("use_cases") or []),
                    quality_score=int(item.get("quality_score") or 3),
                    generated_at=str(item.get("metadata_generated_at") or ""),
                    generator_model=str(
                        item.get("metadata_generator_model") or HEURISTIC_GENERATOR_NAME
                    ),
                    category=str(item.get("category") or ""),
                )
            logger.info("从历史 data.json 加载种子缓存: %s (%d 条)", path.name, len(entries))
            return cls(entries=entries)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError, OSError) as exc:
            logger.warning("读取历史 data.json 失败 %s: %s", path, exc)
            return cls()

    def merge(self, other: "MetadataCache") -> int:
        """合并另一份缓存（仅补充当前不存在的条目），返回新增条数"""
        added = 0
        for key, value in other.entries.items():
            if key not in self.entries:
                self.entries[key] = value
                added += 1
        return added

    def save(self, path: Path) -> None:
        """持久化缓存到磁盘"""
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            key: {
                "summary": value.summary,
                "use_cases": value.use_cases,
                "quality_score": value.quality_score,
                "category": value.category,
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


def should_reuse_cached_metadata(metadata: RepoMetadata | None, has_llm: bool) -> bool:
    """判断缓存中的元数据是否可复用

    规则:
        - 空或无摘要时不可复用
        - 当前已启用 LLM，而缓存为 heuristic 生成时返回 False，触发自动升级
    """
    if metadata is None or not metadata.summary.strip():
        return False
    if has_llm and metadata.generator_model == HEURISTIC_GENERATOR_NAME:
        return False
    return True


def _sanitize_url(raw_url: Any) -> str:
    """只允许 http/https URL，过滤异常或潜在危险 scheme"""
    if not isinstance(raw_url, str):
        return ""
    cleaned = raw_url.strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme.lower() in ("http", "https") and parsed.netloc:
        return cleaned
    return ""


def _extract_license(license_obj: Any) -> str:
    """提取标准化的开源协议简称"""
    if isinstance(license_obj, dict):
        spdx = str(license_obj.get("spdx_id") or "").strip()
        if spdx and spdx.upper() != "NOASSERTION":
            return spdx
        name = str(license_obj.get("name") or "").strip()
        if name and name.lower() != "other":
            return name
        return ""
    if isinstance(license_obj, str):
        return license_obj.strip()
    return ""


class GitHubStarredClient:
    """GitHub starred API 封装

    处理分页、starred_at 解析、有限次速率限制重试、README 线程安全拉取等细节。
    """

    def __init__(self, token: str, username: str):
        self.token = token
        self.username = username
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "star-knowledge-base/1.1",
        }
        self.session = self._create_session()
        self._thread_local = threading.local()

    def _create_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(self._headers)
        return session

    def _get_session(self) -> requests.Session:
        """主线程复用 self.session，子线程使用 thread-local Session 保证线程安全"""
        if threading.current_thread() is threading.main_thread():
            return self.session
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = self._create_session()
            self._thread_local.session = session
        return session

    def fetch_starred(self) -> list[StarredRepo]:
        """拉取所有 starred 仓库（含 starred_at 时间戳）"""
        url = GITHUB_API_BASE + GITHUB_STARRED_PATH.format(username=self.username)
        all_repos: list[StarredRepo] = []
        page = 1

        while True:
            logger.info("拉取 starred 第 %d 页", page)
            response = self._request_with_retry(
                "GET",
                url,
                params={"page": page, "per_page": PAGE_SIZE},
                headers={"Accept": GITHUB_STAR_ACCEPT},
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
            decoded = base64.b64decode(content).decode("utf-8", errors="ignore")
            return decoded[:max_chars]
        except Exception as exc:
            logger.debug("拉取 README 失败 %s/%s: %s", owner, repo, exc)
            return ""

    def _request_with_retry(self, method: str, url: str, **kwargs) -> requests.Response:
        """带有限次数上限的速率限制与瞬时故障重试封装"""
        kwargs.setdefault("timeout", REQUEST_TIMEOUT_SECONDS)
        session = self._get_session()

        for attempt in range(MAX_GITHUB_RETRIES):
            response = session.request(method, url, **kwargs)
            can_retry = attempt < MAX_GITHUB_RETRIES - 1

            if can_retry and response.status_code == 403:
                remaining = response.headers.get("X-RateLimit-Remaining")
                if remaining == "0":
                    reset_ts = int(response.headers.get("X-RateLimit-Reset", "0") or 0)
                    wait = max(reset_ts - int(time.time()), 1) if reset_ts > 0 else 2 ** (attempt + 1)
                    sleep_seconds = min(wait, RATE_LIMIT_WAIT_SECONDS)
                    logger.warning("触发 GitHub 速率限制，等待 %ds 后重试", sleep_seconds)
                    time.sleep(sleep_seconds)
                    continue

            if can_retry and (
                response.status_code == 429 or "Retry-After" in response.headers
            ):
                retry_after_raw = response.headers.get("Retry-After", "")
                try:
                    wait = int(float(retry_after_raw))
                except (TypeError, ValueError):
                    wait = 2 ** (attempt + 1)
                sleep_seconds = min(max(wait, 1), RATE_LIMIT_WAIT_SECONDS)
                logger.warning("触发 HTTP %d / Retry-After，等待 %ds 后重试", response.status_code, sleep_seconds)
                time.sleep(sleep_seconds)
                continue

            if can_retry and response.status_code in RETRYABLE_HTTP_STATUS:
                sleep_seconds = min(2 ** attempt, RATE_LIMIT_WAIT_SECONDS)
                logger.warning("GitHub 返回 HTTP %d，%ds 后重试", response.status_code, sleep_seconds)
                time.sleep(sleep_seconds)
                continue

            response.raise_for_status()
            return response

        response.raise_for_status()  # pragma: no cover
        return response

    @staticmethod
    def _parse_starred_item(item: dict) -> StarredRepo | None:
        """从 GitHub API 响应解析 StarredRepo（兼容 star+json 包装与扁平格式）"""
        try:
            if isinstance(item.get("repo"), dict):
                repo_data = item["repo"]
                starred_at = str(item.get("starred_at") or "")
            else:
                repo_data = item
                starred_at = str(item.get("starred_at") or "")

            full_name = repo_data["full_name"]
            owner, _ = full_name.split("/", 1)
            topics_raw = repo_data.get("topics") or []
            topics = [str(t) for t in topics_raw if t]

            return StarredRepo(
                full_name=full_name,
                name=repo_data["name"],
                owner=owner,
                html_url=repo_data["html_url"],
                description=repo_data.get("description"),
                language=repo_data.get("language"),
                topics=topics,
                stargazers_count=int(repo_data.get("stargazers_count", 0) or 0),
                forks_count=int(repo_data.get("forks_count", 0) or 0),
                open_issues_count=int(repo_data.get("open_issues_count", 0) or 0),
                pushed_at=str(repo_data.get("pushed_at") or ""),
                updated_at=str(repo_data.get("updated_at") or ""),
                starred_at=starred_at,
                archived=bool(repo_data.get("archived", False)),
                homepage=_sanitize_url(repo_data.get("homepage")),
                license=_extract_license(repo_data.get("license")),
            )
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("解析 starred 条目失败: %s", exc)
            return None


class MetadataGenerator:
    """元数据生成器

    双模式工作:
        - LLM 模式（推荐）: 配置了 LLM_API_KEY 时，调用 LLM 生成高质量中文摘要、场景标签、大类和评分
        - 启发式模式（零摩擦）: 未配置 LLM 时，用 GitHub API 原始数据启发式生成
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
            summary = str(result.get("summary", "")).strip()
            if not summary:
                raise ValueError("LLM 返回空 summary")
            raw_category = str(result.get("category", "")).strip()
            category = (
                raw_category
                if raw_category in CATEGORIES
                else _infer_heuristic_category(repo)
            )
            return RepoMetadata(
                summary=summary,
                use_cases=[str(item).strip() for item in result.get("use_cases", []) if str(item).strip()][:5],
                quality_score=self._clamp_quality_score(result.get("quality_score")),
                generated_at=datetime.now(timezone.utc).isoformat(),
                generator_model=self.model_name,
                category=category,
            )
        except (LLMError, ValueError) as exc:
            logger.warning("LLM 元数据生成失败 %s: %s，降级到启发式", repo.full_name, exc)
            return self._heuristic_metadata(repo, readme_excerpt)

    @staticmethod
    def _system_prompt() -> str:
        """系统提示词：约束 LLM 输出结构化 JSON"""
        categories_str = " / ".join(CATEGORIES)
        return (
            "你是一个代码仓库元数据分析助手。根据用户提供的仓库信息，生成结构化的中文元数据。"
            "输出必须是合法的 JSON 对象，包含以下字段：\n"
            "- summary: 一句话中文摘要，不超过 80 个字，描述这个项目解决什么问题、核心特点是什么\n"
            "- use_cases: 数组，列出 2-5 个典型中文适用场景，每个场景不超过 20 个字\n"
            f"- category: 字符串，必须从以下枚举中精确选一个：{categories_str}\n"
            "- quality_score: 整数 1-5，综合 star 数、活跃度、文档与工程质量的评分\n"
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
            f"是否已归档: {'是' if repo.archived else '否'}\n"
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
        """启发式生成元数据（零摩擦模式，无需 LLM）"""
        summary = _extract_heuristic_summary(repo, readme_excerpt)
        use_cases = _extract_heuristic_use_cases(repo)
        score = _compute_heuristic_quality_score(repo.stargazers_count)
        category = _infer_heuristic_category(repo)
        return RepoMetadata(
            summary=summary,
            use_cases=use_cases,
            quality_score=score,
            generated_at=datetime.now(timezone.utc).isoformat(),
            generator_model=HEURISTIC_GENERATOR_NAME,
            category=category,
        )


def _infer_heuristic_category(repo: StarredRepo) -> str:
    """根据仓库名称、描述、topics 和语言推断规范大类"""
    text_parts = [
        repo.full_name,
        repo.description or "",
        " ".join(repo.topics or []),
    ]
    haystack = " ".join(text_parts).lower()

    for category, keywords in CATEGORY_KEYWORDS:
        for kw in keywords:
            if kw in haystack:
                return category

    if repo.language and repo.language in LANGUAGE_CATEGORY_MAP:
        return LANGUAGE_CATEGORY_MAP[repo.language]

    if not repo.language:
        return "学习/资源"

    return DEFAULT_CATEGORY


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


def load_personal_notes(path: Path) -> dict[str, tuple[bool, str]]:
    """加载可选的个人 notes.json（支持置顶标记与一句话备注）

    支持两种条目格式:
        - {"owner/repo": {"pinned": true, "note": "备注"}}
        - {"owner/repo": "备注"}
    """
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            logger.warning("notes.json 顶层应为 JSON 对象，已忽略")
            return {}
        notes: dict[str, tuple[bool, str]] = {}
        for full_name, value in raw.items():
            key = str(full_name).strip().lower()
            if not key:
                continue
            if isinstance(value, dict):
                pinned = bool(value.get("pinned", False))
                note = str(value.get("note", "") or "").strip()
                notes[key] = (pinned, note)
            elif isinstance(value, str):
                notes[key] = (False, value.strip())
        logger.info("已加载个人备注 notes.json: %d 条", len(notes))
        return notes
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("读取 notes.json 失败，已忽略: %s", exc)
        return {}


def build_entry(
    repo: StarredRepo,
    metadata: RepoMetadata,
    pinned: bool = False,
    note: str = "",
) -> StarKnowledgeEntry:
    """合并原始数据、元数据、外部链接与个人备注，构建最终条目"""
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
        archived=repo.archived,
        homepage=repo.homepage,
        license=repo.license,
        category=metadata.category or _infer_heuristic_category(repo),
        pinned=pinned,
        note=note,
    )


def write_output(
    entries: list[StarKnowledgeEntry],
    output_path: Path,
    username: str = "",
) -> None:
    """写入 public/data.json"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "username": username,
        "total": len(entries),
        "entries": [entry.to_dict() for entry in entries],
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("已写入 %s，共 %d 条", output_path, len(entries))


def _parse_int_env(name: str, default: int, min_val: int, max_val: int | None = None) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("环境变量 %s=%r 非法，使用默认值 %d", name, raw, default)
        return default
    if value < min_val:
        return min_val
    if max_val is not None and value > max_val:
        return max_val
    return value


def _generate_one_metadata(
    repo: StarredRepo,
    github_client: GitHubStarredClient,
    generator: MetadataGenerator,
    use_llm: bool,
) -> tuple[RepoMetadata, bool]:
    """为单个仓库生成元数据，返回 (metadata, should_cache)"""
    need_readme = use_llm or not (repo.description and repo.description.strip())
    readme_excerpt = (
        github_client.fetch_readme_excerpt(repo.owner, repo.name)
        if need_readme
        else ""
    )
    if use_llm:
        metadata = generator.generate(repo, readme_excerpt)
        should_cache = metadata.generator_model != HEURISTIC_GENERATOR_NAME
        return metadata, should_cache

    metadata = MetadataGenerator._heuristic_metadata(repo, readme_excerpt)
    return metadata, True


def main() -> int:
    """主入口

    返回 0 表示成功，非 0 表示失败（供 Actions 判断）。
    """
    start_time = time.time()
    project_root = Path(__file__).resolve().parent.parent
    if load_dotenv is not None:
        env_file = project_root / ".env"
        if env_file.exists():
            load_dotenv(env_file)

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
    concurrency = _parse_int_env(
        ENV_LLM_CONCURRENCY,
        DEFAULT_LLM_CONCURRENCY,
        min_val=1,
        max_val=MAX_LLM_CONCURRENCY,
    )
    max_new_llm = _parse_int_env(ENV_LLM_MAX_NEW_PER_RUN, 0, min_val=0)

    output_dir = project_root / OUTPUT_DIR_NAME
    cache_dir = project_root / ".cache"
    cache_path = cache_dir / CACHE_FILE_NAME
    previous_data_path = cache_dir / PREVIOUS_DATA_FILE_NAME
    output_path = output_dir / OUTPUT_FILE_NAME
    notes_path = project_root / NOTES_FILE_NAME

    if force_refresh:
        logger.info("FORCE_REFRESH=true，忽略缓存重新生成所有元数据")
        cache = MetadataCache()
    else:
        cache = MetadataCache.load(cache_path)
        for seed_path in (previous_data_path, output_path):
            if seed_path.exists():
                seed_cache = MetadataCache.load_from_data_json(seed_path)
                merged = cache.merge(seed_cache)
                if merged:
                    logger.info("从 %s 合并 %d 条历史元数据", seed_path.name, merged)

    github_client = GitHubStarredClient(token=token, username=username)
    try:
        repos = github_client.fetch_starred()
    except requests.RequestException as exc:
        logger.error("拉取 starred 数据失败: %s", exc)
        return 1

    if not repos:
        logger.warning("未拉取到任何 starred 仓库，可能是用户名错误或 star 列表为空")
        write_output([], output_path, username=username)
        return 0

    try:
        llm = build_default_client()
    except LLMError as exc:
        logger.error("LLM 客户端初始化失败: %s", exc)
        return 1

    has_llm = llm is not None
    if not has_llm:
        logger.info("LLM 未配置，使用启发式模式生成元数据（零摩擦模式）")
    else:
        logger.info("LLM 已配置，使用 %s 增强元数据生成（并发=%d）", llm.config.model, concurrency)
    generator = MetadataGenerator(llm)

    resolved: dict[str, RepoMetadata] = {}
    pending_repos: list[StarredRepo] = []

    for repo in repos:
        cached = cache.get(repo.full_name)
        if should_reuse_cached_metadata(cached, has_llm=has_llm):
            assert cached is not None
            if not cached.category:
                cached.category = _infer_heuristic_category(repo)
            resolved[repo.full_name] = cached
        else:
            pending_repos.append(repo)

    logger.info(
        "元数据复用 %d 条，待生成 %d 条",
        len(resolved),
        len(pending_repos),
    )

    if pending_repos:
        if has_llm:
            llm_targets = pending_repos[:max_new_llm] if max_new_llm > 0 else pending_repos
            overflow_targets = pending_repos[len(llm_targets) :]
            if overflow_targets:
                logger.info(
                    "受 LLM_MAX_NEW_PER_RUN=%d 限制，本次 LLM 处理 %d 条，其余 %d 条暂用启发式（不写入缓存）",
                    max_new_llm,
                    len(llm_targets),
                    len(overflow_targets),
                )

            if llm_targets:
                with ThreadPoolExecutor(max_workers=concurrency) as executor:
                    future_map = {
                        executor.submit(
                            _generate_one_metadata,
                            repo,
                            github_client,
                            generator,
                            True,
                        ): repo
                        for repo in llm_targets
                    }
                    completed = 0
                    for future in as_completed(future_map):
                        repo = future_map[future]
                        completed += 1
                        try:
                            metadata, should_cache = future.result()
                        except Exception as exc:  # pragma: no cover
                            logger.warning("并发生成元数据异常 %s: %s，降级到启发式", repo.full_name, exc)
                            metadata = MetadataGenerator._heuristic_metadata(repo, "")
                            should_cache = False
                        resolved[repo.full_name] = metadata
                        if should_cache:
                            cache.put(repo.full_name, metadata)
                        logger.info(
                            "[LLM %d/%d] 生成元数据: %s",
                            completed,
                            len(llm_targets),
                            repo.full_name,
                        )

            for repo in overflow_targets:
                metadata, _ = _generate_one_metadata(repo, github_client, generator, False)
                resolved[repo.full_name] = metadata
        else:
            for index, repo in enumerate(pending_repos, start=1):
                metadata, should_cache = _generate_one_metadata(
                    repo, github_client, generator, False
                )
                resolved[repo.full_name] = metadata
                if should_cache:
                    cache.put(repo.full_name, metadata)
                logger.info(
                    "[启发式 %d/%d] 生成元数据: %s",
                    index,
                    len(pending_repos),
                    repo.full_name,
                )

    personal_notes = load_personal_notes(notes_path)
    entries: list[StarKnowledgeEntry] = []
    for repo in repos:
        metadata = resolved[repo.full_name]
        pinned, note = personal_notes.get(repo.full_name.lower(), (False, ""))
        entries.append(build_entry(repo, metadata, pinned=pinned, note=note))

    write_output(entries, output_path, username=username)
    cache.save(cache_path)

    elapsed = time.time() - start_time
    logger.info("==== sync_stars 完成，耗时 %.1fs ====", elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
