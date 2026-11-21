"""llm_client.py 单元测试"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from _stubs import install_stubs_if_missing

install_stubs_if_missing()

import llm_client  # noqa: E402


class TestLLMConfig(unittest.TestCase):
    def test_empty_env_vars_fall_back_to_defaults(self):
        env = {
            "LLM_PROVIDER": "",
            "LLM_API_KEY": "test-key",
            "LLM_MODEL": "   ",
            "LLM_BASE_URL": "",
            "LLM_TIMEOUT": "",
        }
        with patch.dict(os.environ, env, clear=True):
            cfg = llm_client.LLMConfig.from_env()
        self.assertEqual(cfg.provider, "openai")
        self.assertEqual(cfg.model, llm_client.DEFAULT_MODEL_OPENAI)
        self.assertIsNone(cfg.base_url)
        self.assertEqual(cfg.timeout_seconds, llm_client.DEFAULT_TIMEOUT_SECONDS)

    def test_anthropic_empty_model_uses_updated_default(self):
        env = {
            "LLM_PROVIDER": "anthropic",
            "LLM_API_KEY": "test-key",
            "LLM_MODEL": "",
        }
        with patch.dict(os.environ, env, clear=True):
            cfg = llm_client.LLMConfig.from_env()
        self.assertEqual(cfg.provider, "anthropic")
        self.assertEqual(cfg.model, llm_client.DEFAULT_MODEL_ANTHROPIC)

    def test_invalid_timeout_raises_llm_error_and_default_client_degrades(self):
        env = {
            "LLM_PROVIDER": "openai",
            "LLM_API_KEY": "test-key",
            "LLM_TIMEOUT": "abc",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(llm_client.LLMError):
                llm_client.LLMConfig.from_env()
            self.assertIsNone(llm_client.build_default_client())

    def test_non_positive_timeout_raises_llm_error(self):
        env = {
            "LLM_PROVIDER": "openai",
            "LLM_API_KEY": "test-key",
            "LLM_TIMEOUT": "0",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(llm_client.LLMError):
                llm_client.LLMConfig.from_env()


class TestGenerateJson(unittest.TestCase):
    def _make_client_returning(self, text: str) -> llm_client.LLMClient:
        cfg = llm_client.LLMConfig(provider="openai", api_key="k", model="m")
        with patch.object(llm_client.LLMClient, "_build_client", return_value=object()):
            client = llm_client.LLMClient(cfg)
        client.generate_completion = lambda **kwargs: text  # type: ignore[method-assign]
        return client

    def test_strips_markdown_json_fence(self):
        client = self._make_client_returning('```json\n{"summary": "测试摘要", "quality_score": 4}\n```')
        parsed = client.generate_json("sys", "usr")
        self.assertEqual(parsed["summary"], "测试摘要")
        self.assertEqual(parsed["quality_score"], 4)

    def test_extracts_json_from_surrounding_prose(self):
        client = self._make_client_returning('分析结果如下：\n{"ranked": ["a/b"]}\n希望有帮助。')
        parsed = client.generate_json("sys", "usr")
        self.assertEqual(parsed["ranked"], ["a/b"])

    def test_rejects_non_object_json(self):
        client = self._make_client_returning('["a", "b"]')
        with self.assertRaises(llm_client.LLMError):
            client.generate_json("sys", "usr")


if __name__ == "__main__":
    unittest.main()
