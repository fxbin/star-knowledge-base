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

1. 用户提到需要某个库/框架/工具时，调用 search_starred 工具搜索 star 知识库
2. 如果找到相关结果，展示项目信息，包含：项目名称和描述、star 数、语言、topics、LLM 生成的摘要和场景标签、DeepWiki 链接、Zread 链接
3. 如果用户想深入了解某个项目，建议点击 DeepWiki 或 Zread 链接
4. 只有当 star 知识库中没有相关结果时，才建议 Google 搜索

## MCP 工具

- search_starred(query) - 语义搜索 star 项目，返回匹配列表
- get_project_details(repo) - 获取单个项目详情
