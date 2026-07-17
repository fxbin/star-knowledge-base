# Star Knowledge Base

> 让你的 GitHub Stars 从收藏夹变成 agent 可检索的个人代码工具箱。

## 项目定位

通过 GitHub Pages 部署你的 star 项目知识库，本地 agent 通过 MCP server 接入，迅速获取合适的项目。一句话定位：**Google 之前先问 agent**。

## 核心痛点

开发者 star 项目后往往会遗忘。star 500+ 个项目，三个月后能记住的不到 10%。当需要某个库时，习惯性 Google 搜索，找到新库后发现其实自己 star 过。这个工具让 agent 帮你从 star 列表中做语义推荐，省去重复搜索的时间。

## 零摩擦设计

本项目遵循**零摩擦原则**，不配任何 LLM API key 也能跑：

| 模式 | 元数据生成 | 搜索方式 | 适用场景 |
|------|------------|----------|----------|
| **启发式模式**（默认，零门槛） | description + README 第一段 + topics + star 数评分 | 加权关键词匹配 | clone 即可跑，适合快速试用 |
| **LLM 增强模式**（推荐） | LLM 生成中文摘要、场景标签、质量评分 | 关键词预筛 + LLM 语义精排 | 配了 LLM key 后自动启用，质量大幅提升 |

推荐使用**免费的**智谱 GLM-4-Flash API（国内首选，完全免费，OpenAI 兼容接口）。

## 免费 LLM API 渠道推荐

| 渠道 | 费用 | OpenAI 兼容 | 国内访问 | base_url | model |
|------|------|-------------|----------|----------|-------|
| **智谱 GLM-4-Flash** ⭐ | **完全免费** | 是 | 稳定 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 智谱 GLM-4.7-Flash | 完全免费，性能更强 | 是 | 稳定 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7-flash` |
| Groq | 免费速率限制 | 是 | 需代理 | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | 付费但极便宜 | 是 | 稳定 | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI 官方 | 付费 | - | 需代理 | 留空 | `gpt-4o-mini` |
| Anthropic Claude | 付费 | - | 需代理 | 留空 | `claude-3-5-sonnet-20241022` |

**关于 DeepWiki/Zread**：它们是"按需实时生成文档"的工具，没有批量预计算摘要的 API，不能替代 sync 阶段的 LLM。本项目通过 `deepwiki_url` / `zread_url` 字段让 agent 在查询时实时调用它们的 MCP，做深度理解（多跳推理），职责分离。

## 架构

```
GitHub Actions（定时）→ 拉 star 数据 + LLM 生成元数据 → JSON
                                                          ↓
                                                    push 到 gh-pages
                                                          ↓
                                          GitHub Pages: data.json + 搜索页
                                                          ↓
                                    ┌─────────────────────┴──────────────────┐
                                    ↓                                        ↓
                              浏览器访问                              本地 MCP server
                              （人类用搜索页）                    （HTTP 拉 JSON，agent 用）
```

### 技术栈

| 组件 | 技术方案 | 说明 |
|------|----------|------|
| 数据获取 | GitHub starred API + Actions | 定时拉取 starred 数据 |
| 元数据推断 | LLM 从 README/topics 生成 | 摘要、场景标签、质量评分，零摩擦 |
| 部署托管 | GitHub Pages | JSON + 静态搜索页，零后端 |
| Agent 数据访问 | MCP server | HTTP 拉取 Pages 上的 JSON |
| 行为引导 | Agent Skill | 教 agent 优先查 star 知识库 |
| 深度文档 | DeepWiki / Zread 外链 | 项目卡片加深度阅读按钮 |
| 语义匹配 | LLM 实时匹配 | 无需向量数据库，随模型升级自动变好 |

### MCP + Skill 双接入

| 机制 | 定位 | 跨平台 | 功能 |
|------|------|--------|------|
| MCP server | 集成层（数据访问） | 是 | 运行时搜索 star JSON |
| Agent Skill | 知识层（行为引导） | 是 | 教 agent 优先查 star 而非 Google |

两者都跨平台（Claude Code / Cursor / Trae / Codex / OpenCode 等 40+ 工具支持）。MCP 是数据管道，Skill 是行为习惯。

## 项目结构

```
star-knowledge-base/
├── .github/
│   └── workflows/
│       └── sync-stars.yml          # GitHub Actions: 定时拉取 star 数据
├── docs/
│   └── decisions/
│       └── 圆桌讨论-GitHub-Pages-Star-Agent-可行性评估-v3.md   # 完整 6 轮讨论报告（含纠错）
├── public/                          # GitHub Pages 静态文件
│   ├── index.html                   # 搜索页（Vanilla JS）
│   ├── data.json                    # star 数据（Actions 自动生成，gitignore）
│   └── data.example.json            # 数据结构示例
├── skills/
│   └── star-first-habit/
│       └── SKILL.md                 # Agent Skill: 教 agent 优先查 star 知识库
├── src/
│   ├── llm_client.py                # LLM 客户端抽象（OpenAI / Anthropic 可配置）
│   ├── sync_stars.py                # Actions 脚本: 拉数据 + LLM 元数据推断
│   └── mcp_server.py                # MCP server: 暴露 search_starred / get_project_details
├── .env.example                     # 环境变量模板
├── .gitignore
├── requirements.txt                 # Python 依赖
└── README.md
```

## MVP 计划（一周）

| Day | 任务 | 成本 |
|-----|------|------|
| Day 1-2 | Actions 拉 star 数据，生成 JSON | 中 |
| Day 3-4 | MCP server（search_starred + get_project_details） | 中 |
| Day 5 | Pages 搜索页 + DeepWiki/Zread 外链 + SKILL.md | 低 |
| Day 6-7 | 自用测试 | 低 |

### 成功标准

- 一周内使用次数 >= 5 次
- 至少 3 次"发现了忘了 star 过的项目"
- 主观推荐准确率 >= 3.5 分
- Google 搜库行为减少 >= 30%

## 使用方式

### 1. Fork 或 Clone 仓库

```bash
git clone https://github.com/<your-username>/star-knowledge-base.git
cd star-knowledge-base
```

### 2. 配置 GitHub Actions Secrets

在仓库 `Settings → Secrets and variables → Actions` 中添加以下 Secrets：

| Secret 名称 | 必填 | 说明 | 示例 |
|--------------|------|------|------|
| `STAR_GITHUB_USERNAME` | 是 | 要拉取 starred 的 GitHub 用户名 | `octocat` |
| `LLM_PROVIDER` | 否 | LLM 提供商，不配则启发式模式 | `openai` |
| `LLM_API_KEY` | 否 | LLM API 密钥，不配则启发式模式 | 智谱免费 key |
| `LLM_BASE_URL` | 否 | LLM API 基础 URL（OpenAI 兼容接口用） | `https://open.bigmodel.cn/api/paas/v4` |
| `LLM_MODEL` | 否 | 模型名称（不配用默认值） | `glm-4-flash` |

**零门槛快速试用**：只配 `STAR_GITHUB_USERNAME` 就能跑，sync 会用启发式模式生成元数据。

**推荐配置（智谱免费 API）**：
```
LLM_PROVIDER=openai
LLM_API_KEY=（你在 https://open.bigmodel.cn/ 注册拿到的 key）
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4-flash
```

`GITHUB_TOKEN` 由 Actions 自动注入，无需手动配置。

### 3. 启用 GitHub Pages

在仓库 `Settings → Pages → Build and deployment → Source` 选择 `Deploy from a branch`，分支选 `gh-pages`，目录选 `/ (root)`。首次 Actions 运行后会自动创建 `gh-pages` 分支。

### 4. 手动触发首次同步

进入仓库 `Actions` 页面，选择 `Sync Stars` workflow，点击 `Run workflow` 即可手动触发首次同步。之后每天 UTC 02:00（北京时间 10:00）自动运行。

### 5. 本地配置 MCP server

在你的 agent（Trae / Cursor / Claude Code / Codex 等）的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "star-knowledge": {
      "command": "python",
      "args": ["/absolute/path/to/star-knowledge-base/src/mcp_server.py"],
      "env": {
        "STAR_DATA_URL": "https://<your-username>.github.io/star-knowledge-base/data.json"
      }
    }
  }
}
```

**零门槛配置**：只配 `STAR_DATA_URL` 就能用，搜索会走关键词匹配模式。

**推荐增强配置（智谱免费 API）**：

```json
{
  "mcpServers": {
    "star-knowledge": {
      "command": "python",
      "args": ["/absolute/path/to/star-knowledge-base/src/mcp_server.py"],
      "env": {
        "STAR_DATA_URL": "https://<your-username>.github.io/star-knowledge-base/data.json",
        "LLM_PROVIDER": "openai",
        "LLM_API_KEY": "你的智谱 key",
        "LLM_BASE_URL": "https://open.bigmodel.cn/api/paas/v4",
        "LLM_MODEL": "glm-4-flash"
      }
    }
  }
}
```

环境变量说明：

| 变量 | 必填 | 说明 |
|------|------|------|
| `STAR_DATA_URL` | 二选一 | data.json 的 URL（生产环境） |
| `STAR_DATA_LOCAL` | 二选一 | 本地 data.json 路径（开发调试） |
| `STAR_REFRESH_SECONDS` | 否 | 数据刷新间隔，默认 3600 |
| `LLM_PROVIDER` | 否 | `openai` 或 `anthropic`，不配则关键词匹配模式 |
| `LLM_API_KEY` | 否 | LLM API 密钥，不配则关键词匹配模式 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容接口的基础 URL |
| `LLM_MODEL` | 否 | 模型名称，有默认值 |

### 6. 安装 Agent Skill（可选）

`star-first-habit` Skill 教 agent 在需要某个库时优先查 star 知识库，而非 Google：

```bash
npx skills add <your-username>/star-knowledge-base --skill star-first-habit
```

Skill 跨平台支持 Claude Code / Cursor / Trae / Codex / OpenCode 等 40+ 工具。

### 7. 本地开发调试

```bash
# 安装依赖
pip install -r requirements.txt

# 本地测试 sync_stars（需要 .env 或手动 export 环境变量）
cp .env.example .env  # 编辑后填入真实配置
python src/sync_stars.py

# 本地测试 MCP server（指向本地生成的 data.json）
export STAR_DATA_LOCAL=./public/data.json
python src/mcp_server.py

# 本地预览 Pages
cd public && python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 环境变量速查

### Actions（部署时）

| 变量 | 来源 | 用途 |
|------|------|------|
| `GITHUB_TOKEN` | Actions 自动注入 | 调用 GitHub starred API + push 到 gh-pages |
| `STAR_GITHUB_USERNAME` | 用户配置 | 指定要拉取的用户 |
| `LLM_PROVIDER` | 用户配置 | LLM 提供商选择 |
| `LLM_API_KEY` | 用户配置 | LLM 鉴权 |
| `LLM_BASE_URL` | 用户配置 | OpenAI 兼容接口地址 |
| `LLM_MODEL` | 用户配置 | 模型名称 |
| `FORCE_REFRESH` | workflow_dispatch 输入 | 强制重新生成所有元数据 |

### MCP server（运行时）

详见上文「本地配置 MCP server」章节。

## 适合人群

star 200+ 的开发者。star 太少（< 100）手动翻就够了。

## 圆桌讨论

本项目的可行性经过 6 轮圆桌讨论验证，参与角色：
- Pieter Levels - 独立开发者视角，MVP 范围和落地速度
- Andrej Karpathy - Agent 架构视角，MCP 协议和技术深度
- 资深开发者工具产品经理 - 用户需求和验证指标

完整讨论报告见 [docs/decisions/](docs/decisions/) 目录。

## License

MIT

---

author: fxbin
