"""sync_stars.py 单元测试"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from _stubs import install_stubs_if_missing

install_stubs_if_missing()

import requests  # noqa: E402
import sync_stars  # noqa: E402


class _DummyResponse:
    def __init__(self, status_code: int, payload=None, headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class TestGitHubStarredClient(unittest.TestCase):
    def test_parse_wrapped_star_json_and_fields(self):
        item = {
            "starred_at": "2026-07-10T03:00:00Z",
            "repo": {
                "full_name": "octocat/Hello-World",
                "name": "Hello-World",
                "html_url": "https://github.com/octocat/Hello-World",
                "description": "Demo repo",
                "language": "Python",
                "topics": ["mcp", "agent"],
                "stargazers_count": 1200,
                "forks_count": 50,
                "open_issues_count": 3,
                "pushed_at": "2026-07-09T00:00:00Z",
                "updated_at": "2026-07-09T01:00:00Z",
                "archived": True,
                "homepage": "https://example.com",
                "license": {"spdx_id": "MIT", "name": "MIT License"},
            },
        }
        repo = sync_stars.GitHubStarredClient._parse_starred_item(item)
        self.assertIsNotNone(repo)
        assert repo is not None
        self.assertEqual(repo.starred_at, "2026-07-10T03:00:00Z")
        self.assertTrue(repo.archived)
        self.assertEqual(repo.homepage, "https://example.com")
        self.assertEqual(repo.license, "MIT")

    def test_parse_flat_item_and_rejects_unsafe_homepage(self):
        item = {
            "full_name": "a/b",
            "name": "b",
            "html_url": "https://github.com/a/b",
            "homepage": "javascript:alert(1)",
            "license": {"spdx_id": "NOASSERTION", "name": "Custom License"},
        }
        repo = sync_stars.GitHubStarredClient._parse_starred_item(item)
        assert repo is not None
        self.assertEqual(repo.homepage, "")
        self.assertEqual(repo.license, "Custom License")
        self.assertEqual(repo.starred_at, "")

    def test_fetch_starred_sends_star_accept_header(self):
        client = sync_stars.GitHubStarredClient(token="tok", username="octocat")
        captured_headers = []

        def fake_request(method, url, **kwargs):
            captured_headers.append(kwargs.get("headers", {}))
            return _DummyResponse(
                200,
                [
                    {
                        "starred_at": "2026-07-01T00:00:00Z",
                        "repo": {
                            "full_name": "octocat/repo1",
                            "name": "repo1",
                            "html_url": "https://github.com/octocat/repo1",
                        },
                    }
                ],
            )

        client.session.request = fake_request  # type: ignore[method-assign]
        repos = client.fetch_starred()
        self.assertEqual(len(repos), 1)
        self.assertEqual(repos[0].starred_at, "2026-07-01T00:00:00Z")
        self.assertEqual(captured_headers[0].get("Accept"), sync_stars.GITHUB_STAR_ACCEPT)

    def test_request_with_retry_is_bounded_on_rate_limit(self):
        client = sync_stars.GitHubStarredClient(token="tok", username="octocat")
        calls = 0

        def always_403(method, url, **kwargs):
            nonlocal calls
            calls += 1
            return _DummyResponse(
                403,
                headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "0"},
            )

        client.session.request = always_403  # type: ignore[method-assign]
        with patch("sync_stars.time.sleep") as mock_sleep:
            with self.assertRaises(requests.HTTPError):
                client._request_with_retry("GET", "https://api.github.com/test")
        self.assertEqual(calls, sync_stars.MAX_GITHUB_RETRIES)
        self.assertEqual(mock_sleep.call_count, sync_stars.MAX_GITHUB_RETRIES - 1)

    def test_request_with_retry_recovers_from_429(self):
        client = sync_stars.GitHubStarredClient(token="tok", username="octocat")
        responses = iter(
            [
                _DummyResponse(429, headers={"Retry-After": "2"}),
                _DummyResponse(200, payload={"ok": True}),
            ]
        )
        client.session.request = lambda *a, **kw: next(responses)  # type: ignore[method-assign]
        with patch("sync_stars.time.sleep") as mock_sleep:
            resp = client._request_with_retry("GET", "https://api.github.com/test")
        self.assertEqual(resp.status_code, 200)
        mock_sleep.assert_called_once_with(2)


class TestCacheAndHeuristics(unittest.TestCase):
    def _make_repo(self, **overrides) -> sync_stars.StarredRepo:
        base = dict(
            full_name="org/demo",
            name="demo",
            owner="org",
            html_url="https://github.com/org/demo",
            description="A nice library",
            language="Python",
            topics=["orm"],
            stargazers_count=1500,
            forks_count=10,
            open_issues_count=1,
            pushed_at="2026-07-01T00:00:00Z",
            updated_at="2026-07-01T00:00:00Z",
            starred_at="2026-07-02T00:00:00Z",
        )
        base.update(overrides)
        return sync_stars.StarredRepo(**base)

    def test_heuristic_mode_skips_readme_when_description_present(self):
        repo_with_desc = self._make_repo(description="Has description")
        repo_without_desc = self._make_repo(full_name="org/nodesc", description="")
        github_client = MagicMock()
        github_client.fetch_readme_excerpt.return_value = "# Readme title\nReal summary line"
        generator = sync_stars.MetadataGenerator(None)

        meta1, cache1 = sync_stars._generate_one_metadata(repo_with_desc, github_client, generator, use_llm=False)
        self.assertTrue(cache1)
        self.assertEqual(meta1.summary, "Has description")
        github_client.fetch_readme_excerpt.assert_not_called()

        meta2, cache2 = sync_stars._generate_one_metadata(repo_without_desc, github_client, generator, use_llm=False)
        self.assertTrue(cache2)
        self.assertEqual(meta2.summary, "Readme title")
        github_client.fetch_readme_excerpt.assert_called_once_with("org", "demo")

    def test_load_from_data_json_and_upgrade_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_path = Path(tmp) / "previous_data.json"
            data_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "entries": [
                            {
                                "full_name": "a/heuristic-repo",
                                "summary": "Old desc",
                                "use_cases": ["python"],
                                "quality_score": 4,
                                "metadata_generated_at": "2026-07-01T00:00:00Z",
                                "metadata_generator_model": "heuristic",
                            },
                            {
                                "full_name": "a/llm-repo",
                                "summary": "AI 摘要",
                                "use_cases": ["Agent 开发"],
                                "quality_score": 5,
                                "category": "AI/Agent",
                                "metadata_generated_at": "2026-07-01T00:00:00Z",
                                "metadata_generator_model": "glm-4.7-flash",
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            seed = sync_stars.MetadataCache.load_from_data_json(data_path)
            self.assertEqual(len(seed.entries), 2)
            self.assertTrue(sync_stars.should_reuse_cached_metadata(seed.get("a/heuristic-repo"), has_llm=False))
            self.assertFalse(sync_stars.should_reuse_cached_metadata(seed.get("a/heuristic-repo"), has_llm=True))
            self.assertTrue(sync_stars.should_reuse_cached_metadata(seed.get("a/llm-repo"), has_llm=True))
            self.assertEqual(seed.get("a/llm-repo").category, "AI/Agent")  # type: ignore[union-attr]

    def test_infer_heuristic_category(self):
        awesome = self._make_repo(full_name="vinta/awesome-python", description="Curated list", topics=["awesome"], language="Python")
        self.assertEqual(sync_stars._infer_heuristic_category(awesome), "学习/资源")

        mcp_repo = self._make_repo(full_name="org/mcp-agent", description="LLM agent server", topics=["mcp", "llm"], language="TypeScript")
        self.assertEqual(sync_stars._infer_heuristic_category(mcp_repo), "AI/Agent")

        spring_repo = self._make_repo(full_name="org/svc", description="Microservice", topics=["spring-boot"], language="Java")
        self.assertEqual(sync_stars._infer_heuristic_category(spring_repo), "后端/框架")

    def test_load_personal_notes(self):
        with tempfile.TemporaryDirectory() as tmp:
            notes_path = Path(tmp) / "notes.json"
            notes_path.write_text(
                json.dumps(
                    {
                        "Octocat/Hello-World": {"pinned": True, "note": "常用模板"},
                        "org/other": "纯字符串备注",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            notes = sync_stars.load_personal_notes(notes_path)
        self.assertEqual(notes["octocat/hello-world"], (True, "常用模板"))
        self.assertEqual(notes["org/other"], (False, "纯字符串备注"))

    def test_main_cache_not_poisoned_when_llm_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_src = root / "src" / "sync_stars.py"
            fake_src.parent.mkdir(parents=True)
            fake_src.touch()

            repo = self._make_repo(full_name="org/fail-llm", description="Fallback desc")
            mock_llm = MagicMock()
            mock_llm.config.model = "glm-4.7-flash"
            mock_llm.generate_json.side_effect = sync_stars.LLMError("rate limit")

            with (
                patch("sync_stars.__file__", str(fake_src)),
                patch.dict(os.environ, {"GITHUB_USERNAME": "u", "GITHUB_TOKEN": "t"}, clear=True),
                patch("sync_stars.GitHubStarredClient.fetch_starred", return_value=[repo]),
                patch("sync_stars.GitHubStarredClient.fetch_readme_excerpt", return_value=""),
                patch("sync_stars.build_default_client", return_value=mock_llm),
            ):
                rc = sync_stars.main()

            self.assertEqual(rc, 0)
            cache_file = root / ".cache" / sync_stars.CACHE_FILE_NAME
            cache_data = json.loads(cache_file.read_text(encoding="utf-8"))
            self.assertNotIn("org/fail-llm", cache_data)
            out_data = json.loads((root / "public" / "data.json").read_text(encoding="utf-8"))
            self.assertEqual(out_data["schema_version"], "1.1")
            self.assertEqual(out_data["username"], "u")
            self.assertEqual(out_data["entries"][0]["summary"], "Fallback desc")


if __name__ == "__main__":
    unittest.main()
