"""mcp_server.py 单元测试"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

TESTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TESTS_DIR.parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from _stubs import build_stub_fastmcp_class, install_stubs_if_missing

install_stubs_if_missing()

import mcp_server  # noqa: E402


def _make_entry(idx: int, **overrides) -> dict:
    base = {
        "full_name": f"org/repo-{idx}",
        "name": f"repo-{idx}",
        "owner": "org",
        "html_url": f"https://github.com/org/repo-{idx}",
        "description": f"Sample repository {idx}",
        "language": "Python",
        "topics": ["python"],
        "stargazers_count": 100 + idx,
        "forks_count": 10,
        "open_issues_count": 2,
        "pushed_at": f"2026-07-{(idx % 28) + 1:02d}T00:00:00Z",
        "starred_at": f"2026-07-{(idx % 28) + 1:02d}T00:00:00Z",
        "archived": False,
        "homepage": "",
        "license": "MIT",
        "category": "后端/框架",
        "summary": f"仓库 {idx} 的说明",
        "use_cases": ["后端开发"],
        "quality_score": 3,
        "deepwiki_url": f"https://deepwiki.com/org/repo-{idx}",
        "zread_url": f"https://zread.ai/org/repo-{idx}",
        "pinned": False,
        "note": "",
    }
    base.update(overrides)
    return base


class TestSemanticSearcher(unittest.TestCase):
    def test_zero_match_returns_empty_without_calling_llm(self):
        mock_llm = MagicMock()
        searcher = mcp_server.SemanticSearcher(mock_llm)
        entries = [_make_entry(1, summary="Redis 客户端"), _make_entry(2, summary="FastAPI 脚手架")]
        results = searcher.search("quantum-blockchain-unicorn", entries, limit=10)
        self.assertEqual(results, [])
        mock_llm.generate_json.assert_not_called()

    def test_chinese_query_tokenization_and_match(self):
        searcher = mcp_server.SemanticSearcher(None)
        entries = [
            _make_entry(1, full_name="a/chat-server", summary="高性能实时聊天与 WebSocket 通信框架"),
            _make_entry(2, full_name="a/sql-tool", category="数据/存储", summary="数据库迁移工具"),
        ]
        results = searcher.search("实时聊天的框架", entries, limit=5)
        self.assertEqual([e["full_name"] for e in results], ["a/chat-server"])

    def test_llm_mode_sorts_before_50_candidate_truncation(self):
        # 构造 60 个低分 Python 仓库（仅语言字段命中 python），把最匹配的 Python ORM 放在第 58 位
        entries = [_make_entry(i, description="Generic helper", summary="通用工具") for i in range(60)]
        entries[58] = _make_entry(
            58,
            full_name="sqlalchemy/python-orm",
            name="python-orm",
            description="Python SQL Toolkit and Object Relational Mapper",
            topics=["python", "orm", "sql"],
            use_cases=["Python ORM 数据建模"],
            quality_score=5,
            stargazers_count=9000,
        )

        captured_candidates = []

        def fake_generate_json(**kwargs):
            captured_candidates.append(kwargs["user_prompt"])
            return {"ranked": ["sqlalchemy/python-orm"]}

        mock_llm = MagicMock()
        mock_llm.generate_json.side_effect = fake_generate_json
        searcher = mcp_server.SemanticSearcher(mock_llm)

        results = searcher.search("python orm", entries, limit=5)
        self.assertEqual([e["full_name"] for e in results], ["sqlalchemy/python-orm"])
        self.assertIn("sqlalchemy/python-orm", captured_candidates[0])


class TestDataLoaderAndMCPTools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data_path = Path(self.tmp.name) / "data.json"
        self.entries = [
            _make_entry(
                1,
                full_name="FastAPI/FastAPI",
                name="FastAPI",
                language="Python",
                topics=["python", "api", "web"],
                category="后端/框架",
                stargazers_count=80000,
                quality_score=5,
                pinned=True,
                note="常用 API 框架",
            ),
            _make_entry(
                2,
                full_name="old/legacy-lib",
                name="legacy-lib",
                language="Java",
                topics=["spring"],
                category="后端/框架",
                stargazers_count=500,
                archived=True,
            ),
            _make_entry(
                3,
                full_name="docs/awesome-ai",
                name="awesome-ai",
                language=None,
                topics=["awesome", "ai"],
                category="学习/资源",
                stargazers_count=12000,
                summary="精选 AI 学习资源清单",
            ),
        ]
        self.data_path.write_text(
            json.dumps(
                {
                    "schema_version": "1.1",
                    "generated_at": "2026-07-29T00:00:00Z",
                    "total": len(self.entries),
                    "entries": self.entries,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.loader = mcp_server.StarDataLoader(local_path=str(self.data_path))
        self.searcher = mcp_server.SemanticSearcher(None)

    def tearDown(self):
        self.tmp.cleanup()

    def _build_tools(self, loader=None):
        loader = loader or self.loader
        if mcp_server.FastMCP is not None:
            server = mcp_server.build_mcp_server(loader, self.searcher)
            # FastMCP 在较新版本中通过 _tool_manager._tools 暴露工具；为跨版本稳定，统一用 stub 或读取
            tool_mgr = getattr(server, "_tool_manager", None)
            if tool_mgr and hasattr(tool_mgr, "_tools"):
                return {name: tool.fn for name, tool in tool_mgr._tools.items()}
        with patch.object(mcp_server, "FastMCP", build_stub_fastmcp_class()):
            server = mcp_server.build_mcp_server(loader, self.searcher)
            return server.tools

    def test_get_project_details_case_insensitive_url_and_short_name(self):
        tools = self._build_tools()
        get_details = tools["get_project_details"]

        res_ci = json.loads(get_details("fastapi/fastapi"))
        self.assertEqual(res_ci["full_name"], "FastAPI/FastAPI")

        res_url = json.loads(get_details("https://github.com/FastAPI/FastAPI.git"))
        self.assertEqual(res_url["full_name"], "FastAPI/FastAPI")

        res_short = json.loads(get_details("awesome-ai"))
        self.assertEqual(res_short["full_name"], "docs/awesome-ai")

    def test_get_project_details_handles_runtime_error(self):
        broken_loader = mcp_server.StarDataLoader(local_path=str(Path(self.tmp.name) / "missing.json"))
        tools = self._build_tools(loader=broken_loader)
        res = json.loads(tools["get_project_details"]("a/b"))
        self.assertIn("error", res)

    def test_search_starred_structured_filters_and_no_match(self):
        tools = self._build_tools()
        search = tools["search_starred"]

        # 过滤无语言仓库
        res_none_lang = json.loads(search(query="", language="__none__"))
        self.assertTrue(res_none_lang["matched"])
        self.assertEqual([r["full_name"] for r in res_none_lang["results"]], ["docs/awesome-ai"])

        # 排除已归档
        res_active = json.loads(search(query="", category="后端/框架", include_archived=False))
        self.assertEqual([r["full_name"] for r in res_active["results"]], ["FastAPI/FastAPI"])

        # 最小 star 数 + 按 star 排序
        res_stars = json.loads(search(query="", min_stars=10000, sort_by="stars"))
        self.assertEqual(
            [r["full_name"] for r in res_stars["results"]],
            ["FastAPI/FastAPI", "docs/awesome-ai"],
        )

        # 未命中返回 matched=False，不返回无关项目
        res_miss = json.loads(search(query="nonexistent-xyz-foo"))
        self.assertFalse(res_miss["matched"])
        self.assertEqual(res_miss["results"], [])

    def test_list_facets(self):
        tools = self._build_tools()
        facets = json.loads(tools["list_facets"](top_n=10))
        self.assertEqual(facets["total"], 3)
        self.assertEqual(facets["archived_count"], 1)
        self.assertEqual(facets["pinned"], ["FastAPI/FastAPI"])
        lang_names = {item["name"] for item in facets["languages"]}
        self.assertIn("__none__", lang_names)
        self.assertIn("Python", lang_names)

    def test_loads_example_data_json_compatibly(self):
        example_path = ROOT_DIR / "public" / "data.example.json"
        loader = mcp_server.StarDataLoader(local_path=str(example_path))
        entries = loader.list_entries()
        self.assertEqual(len(entries), 2)
        results = self.searcher.search("MCP", entries)
        self.assertEqual(results[0]["full_name"], "modelcontextprotocol/python-sdk")


if __name__ == "__main__":
    unittest.main()
