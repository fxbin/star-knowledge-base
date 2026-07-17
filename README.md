# Star Knowledge Base

> 让你的 GitHub Stars 从收藏夹变成 agent 可检索的个人代码工具箱。

## 项目定位

通过 GitHub Pages 部署你的 star 项目知识库，本地 agent 通过 MCP server 接入，迅速获取合适的项目。一句话定位：**Google 之前先问 agent**。

## 核心痛点

开发者 star 项目后往往会遗忘。star 500+ 个项目，三个月后能记住的不到 10%。当需要某个库时，习惯性 Google 搜索，找到新库后发现其实自己 star 过。这个工具让 agent 帮你从 star 列表中做语义推荐，省去重复搜索的时间。

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
│   ├── 圆桌讨论-GitHub-Pages-Star-Agent-可行性评估.md      # Round 1-3 讨论报告
│   ├── 圆桌讨论-GitHub-Pages-Star-Agent-可行性评估-v3.md   # 完整 6 轮讨论报告（含纠错）
│   ├── roundtable-github-pages-agent-20260717.json         # Memory JSON v1
│   └── roundtable-github-pages-agent-v3-20260717.json      # Memory JSON v3（完整版）
├── public/                          # GitHub Pages 静态文件
│   ├── index.html                   # 搜索页（TODO）
│   └── data.json                    # star 数据（Actions 自动生成）
├── skills/
│   └── star-first-habit/
│       └── SKILL.md                 # Agent Skill: 教 agent 优先查 star 知识库
├── src/
│   ├── sync_stars.py                # Actions 脚本: 拉数据 + LLM 元数据推断
│   └── mcp_server.py                # MCP server: 暴露 search_starred 等工具
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

1. clone repo
2. 配置 GitHub token（Actions secrets）
3. 配置 LLM API key（Actions secrets，用于元数据推断）
4. Actions 自动运行，生成 data.json 并部署到 Pages
5. MCP server 配置指向 Pages 上的 JSON URL
6. npx skills add 安装 Skill

## 适合人群

star 200+ 的开发者。star 太少（< 100）手动翻就够了。

## 圆桌讨论

本项目的可行性经过 6 轮圆桌讨论验证，参与角色：
- Pieter Levels - 独立开发者视角，MVP 范围和落地速度
- Andrej Karpathy - Agent 架构视角，MCP 协议和技术深度
- 资深开发者工具产品经理 - 用户需求和验证指标

完整讨论报告见 docs/ 目录。

## License

MIT

---

author: fxbin
