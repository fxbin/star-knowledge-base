"""
LLM 客户端抽象层

支持多家 LLM 提供商，通过统一接口调用，屏蔽底层 SDK 差异。
便于 sync_stars.py 和 mcp_server.py 共用同一套调用逻辑。

支持的提供商（通过环境变量 LLM_PROVIDER 选择）:
    - openai:    OpenAI 官方 API 或任意 OpenAI 兼容接口
                 （DeepSeek / Qwen / Moonshot / 智谱 GLM / 自部署 vLLM 等）
    - anthropic: Anthropic Claude API

环境变量配置:
    LLM_PROVIDER  提供商类型，默认 openai
    LLM_API_KEY   API 密钥
    LLM_BASE_URL  API 基础 URL（可选，用于 OpenAI 兼容接口）
    LLM_MODEL     模型名称
    LLM_TIMEOUT   请求超时秒数，默认 60

设计原则:
    - 简洁至上：只暴露一个统一方法 generate_completion
    - 可配置：所有可变项走环境变量，禁止魔法值
    - 容错：内置重试与异常包装，调用方只需捕获 LLMError

author: fxbin
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


# 常量定义（禁止魔法值）
PROVIDER_OPENAI = "openai"
PROVIDER_ANTHROPIC = "anthropic"

DEFAULT_PROVIDER = PROVIDER_OPENAI
DEFAULT_MODEL_OPENAI = "gpt-4o-mini"
DEFAULT_MODEL_ANTHROPIC = "claude-3-5-sonnet-20241022"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 1024

MAX_RETRY_TIMES = 3
RETRY_BACKOFF_BASE_SECONDS = 1.5

ENV_PROVIDER = "LLM_PROVIDER"
ENV_API_KEY = "LLM_API_KEY"
ENV_BASE_URL = "LLM_BASE_URL"
ENV_MODEL = "LLM_MODEL"
ENV_TIMEOUT = "LLM_TIMEOUT"


class LLMError(Exception):
    """LLM 调用统一异常类型"""


@dataclass
class LLMConfig:
    """LLM 客户端配置

    通过 from_env() 从环境变量加载，或直接构造用于测试注入。
    """

    provider: str
    api_key: str
    model: str
    base_url: str | None = None
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls) -> "LLMConfig":
        """从环境变量加载配置

        缺失必填项时抛出 LLMError，便于调用方快速定位配置问题。
        """
        provider = os.getenv(ENV_PROVIDER, DEFAULT_PROVIDER).lower()
        api_key = os.getenv(ENV_API_KEY, "").strip()
        if not api_key:
            raise LLMError(f"环境变量 {ENV_API_KEY} 未配置，无法初始化 LLM 客户端")

        if provider == PROVIDER_ANTHROPIC:
            model = os.getenv(ENV_MODEL, DEFAULT_MODEL_ANTHROPIC)
        else:
            model = os.getenv(ENV_MODEL, DEFAULT_MODEL_OPENAI)

        base_url = os.getenv(ENV_BASE_URL, "").strip() or None
        timeout_seconds = int(os.getenv(ENV_TIMEOUT, str(DEFAULT_TIMEOUT_SECONDS)))

        return cls(
            provider=provider,
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
        )


class LLMClient:
    """LLM 统一客户端

    根据 provider 字段分发到对应 SDK，对外只暴露 generate_completion。
    调用方无需关心底层是 OpenAI 还是 Anthropic。
    """

    def __init__(self, config: LLMConfig):
        self.config = config
        self._client = self._build_client()

    def _build_client(self) -> Any:
        """根据 provider 构建底层 SDK 客户端"""
        if self.config.provider == PROVIDER_OPENAI:
            return self._build_openai_client()
        if self.config.provider == PROVIDER_ANTHROPIC:
            return self._build_anthropic_client()
        raise LLMError(f"不支持的 LLM provider: {self.config.provider}")

    def _build_openai_client(self) -> Any:
        """构建 OpenAI 兼容客户端"""
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise LLMError("未安装 openai SDK，请运行 pip install openai") from exc

        kwargs = {
            "api_key": self.config.api_key,
            "timeout": self.config.timeout_seconds,
        }
        if self.config.base_url:
            kwargs["base_url"] = self.config.base_url
        return OpenAI(**kwargs)

    def _build_anthropic_client(self) -> Any:
        """构建 Anthropic 客户端"""
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise LLMError("未安装 anthropic SDK，请运行 pip install anthropic") from exc

        kwargs = {
            "api_key": self.config.api_key,
            "timeout": self.config.timeout_seconds,
        }
        if self.config.base_url:
            kwargs["base_url"] = self.config.base_url
        return Anthropic(**kwargs)

    def generate_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        response_format_json: bool = False,
    ) -> str:
        """生成一次补全结果

        参数:
            system_prompt:        系统提示词，约束模型行为
            user_prompt:          用户提示词，包含具体任务描述
            temperature:          采样温度，越低输出越确定
            max_tokens:           最大输出 token 数
            response_format_json: 是否要求返回 JSON 格式

        返回:
            模型生成的文本内容

        异常:
            LLMError: 调用失败（网络、鉴权、模型异常等）
        """
        last_error: Exception | None = None
        for attempt in range(1, MAX_RETRY_TIMES + 1):
            try:
                if self.config.provider == PROVIDER_OPENAI:
                    return self._call_openai(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        response_format_json=response_format_json,
                    )
                return self._call_anthropic(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                last_error = exc
                if attempt < MAX_RETRY_TIMES:
                    wait_seconds = RETRY_BACKOFF_BASE_SECONDS ** attempt
                    logger.warning(
                        "LLM 调用第 %d 次失败，%ds 后重试: %s",
                        attempt,
                        wait_seconds,
                        exc,
                    )
                    time.sleep(wait_seconds)

        raise LLMError(f"LLM 调用重试 {MAX_RETRY_TIMES} 次后仍失败: {last_error}") from last_error

    def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> dict:
        """生成 JSON 结构化结果

        在 generate_completion 之上做 JSON 解析与校验，
        失败时抛出 LLMError，避免调用方重复处理解析逻辑。
        """
        raw = self.generate_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format_json=True,
        )
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise LLMError(f"LLM 返回内容无法解析为 JSON: {raw[:200]}") from exc

        if not isinstance(parsed, dict):
            raise LLMError(f"LLM 返回 JSON 顶层不是对象: {type(parsed).__name__}")
        return parsed

    def _call_openai(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
        response_format_json: bool,
    ) -> str:
        """调用 OpenAI 兼容接口"""
        kwargs = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format_json:
            kwargs["response_format"] = {"type": "json_object"}

        response = self._client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    def _call_anthropic(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> str:
        """调用 Anthropic Claude 接口"""
        response = self._client.messages.create(
            model=self.config.model,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not response.content:
            return ""
        return response.content[0].text


def build_default_client() -> LLMClient | None:
    """便捷工厂：从环境变量构建默认 LLM 客户端

    供 sync_stars.py 和 mcp_server.py 共用，避免重复样板代码。

    返回:
        LLMClient 实例；若 LLM_API_KEY 未配置则返回 None，
        调用方应据此降级到启发式逻辑（零摩擦设计）。
    """
    try:
        return LLMClient(LLMConfig.from_env())
    except LLMError as exc:
        logger.info("LLM 未配置或配置不完整，将降级到启发式模式: %s", exc)
        return None
