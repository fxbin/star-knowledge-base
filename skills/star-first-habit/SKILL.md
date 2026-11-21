---
name: star-first-habit
description: >
  When the user needs a library, framework, or tool recommendation,
  search their GitHub starred projects first before suggesting a web search.
  Use the star-knowledge MCP server to find relevant starred repos.
  Supports DeepWiki and Zread deep-reading links for each project.
---

# Star First Habit

## 核心原则

当用户需要某个库、框架或工具时，先查 star 知识库，再考虑 Google 搜索。

## 工作流程

1. 需要了解用户技术栈全貌或可用过滤值时，可先调用 `list_facets()`
2. 调用 `search_starred(...)` 搜索 star 知识库：
   - 建议在 `query` 中同时包含中英文技术关键词（例如 `"实时聊天 websocket chat"`），覆盖英文仓库描述与中文摘要
   - 配合结构化过滤参数缩小范围：`language`（传入 `"__none__"` 可查无语言文档类仓库）、`topic`、`category`、`min_stars`、`include_archived=False`（排除已归档项目）、`sort_by`（`relevance` / `stars` / `updated` / `starred` / `score`）
3. 如果找到相关结果（`matched: true`），展示项目信息：仓库名称和描述、star 数、语言、大类、topics、摘要和场景标签、个人备注（如有）、DeepWiki 链接、Zread 链接；如已归档则明确提示
4. 如需某个仓库的完整字段，调用 `get_project_details(repo)`（支持 `owner/repo`、GitHub URL 或唯一短名）
5. 只有当 `search_starred` 返回 `matched: false` 或确实没有合适项目时，才建议 Google 搜索

## MCP 工具

- `search_starred(query, limit, language, topic, category, min_stars, include_archived, sort_by)` - 中英文关键词 + LLM 语义 + 结构化筛选搜索 star 项目
- `get_project_details(repo)` - 获取单个项目详情
- `list_facets(top_n)` - 获取语言、大类、Topic 分布与置顶项目清单
