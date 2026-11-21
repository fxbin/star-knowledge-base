"""测试辅助桩模块

当本地验证环境缺少 requests 或 mcp 等第三方依赖时，提供最小兼容桩，
保证单元测试在无外网、零额外安装包下也可运行；在 CI 安装完整依赖后自动使用真实包。
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def install_stubs_if_missing() -> None:
    """按需注入缺失的第三方依赖桩"""
    if "requests" not in sys.modules:
        try:
            import requests  # noqa: F401
        except ImportError:
            requests_mod = types.ModuleType("requests")

            class RequestException(Exception):
                pass

            class HTTPError(RequestException):
                pass

            class _Response:
                status_code = 200
                headers: dict = {}
                text = ""

                def json(self):
                    return {}

                def raise_for_status(self):
                    if self.status_code >= 400:
                        raise HTTPError(f"HTTP {self.status_code}")

            class Session:
                def __init__(self):
                    self.headers = {}

                def request(self, method, url, **kwargs):
                    raise RequestException("requests stub called without mock")

            def _get(*args, **kwargs):
                raise RequestException("requests.get stub called without mock")

            requests_mod.RequestException = RequestException
            requests_mod.HTTPError = HTTPError
            requests_mod.Response = _Response
            requests_mod.Session = Session
            requests_mod.get = _get
            sys.modules["requests"] = requests_mod


def build_stub_fastmcp_class():
    """在未安装 mcp SDK 的测试环境中提供最小 FastMCP 兼容桩"""

    class _StubFastMCP:
        def __init__(self, name: str, instructions: str = ""):
            self.name = name
            self.instructions = instructions
            self.tools: dict = {}

        def tool(self):
            def decorator(fn):
                self.tools[fn.__name__] = fn
                return fn

            return decorator

        def run(self):
            return None

    return _StubFastMCP
