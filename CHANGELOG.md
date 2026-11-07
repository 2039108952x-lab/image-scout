# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.0] — 2026-11-07

**面向可发现性的改版。**

### 变更

- 仓库更名为 **`image-scout`**（原 `web-image-finder`）。GitHub 会保留旧地址的重定向。
  技能文件内部的注册名仍为 `web-image-finder`，不影响已安装的客户端。
- README 全面重写：新增 tagline、4 个 shields 徽章、30 秒上手、贡献指南
- 收紧开头结构：`为什么` → `核心链路` → `上手`，让人三屏内能判断要不要用

### 新增

- GitHub topics（12 个）：`ai-agent`、`image-search`、`mcp`、`skill`、`claude`、
  `llm-tools`、`agent-tools`、`web-scraping`、`image-download`、`wikimedia`、
  `openverse`、`zero-dependencies`
- 英文 description，关键词前置，便于搜索命中

## [1.1.0] — 2026-11-07

**从"内部笔记"升级为可开源技能包。**

### 新增

- `README.md`：面向人的完整介绍——它解决什么问题、和现成 API 的取舍、快速开始、目录结构
- `LICENSE`：MIT
- `examples/`：真实实测案例
- `CHANGELOG.md`：本文件
- SKILL.md 增加 frontmatter 字段 `version` / `license`
- SKILL.md 新增「什么时候不用」一节，明确与 `comfyui-local` 的边界
- SKILL.md 新增失败模式对照表（6 种现象 → 原因 → 换法）
- SKILL.md 新增版权与合规专节
- SKILL.md 新增交付清单

### 改进

- 图源说明补齐实测数据（关键词 → 结果数 → 候选数）
- 把 `import_web_image` 的三条硬约束合并成一张表，并解释底层规则
  （校验的是"URL 是否在该页面出现过"，不是"能否下载"）
- 接 ComfyUI 一节补上实测耗时

## [1.0.0] — 2026-11-07

初始版本。

### 内容

- 核心链路：`web_fetch` → `import_web_image` → `view_image`
- 三级图源优先级：Wikimedia Commons → File 详情页取高清 → Openverse → `web_search` 兜底
- `import_web_image` 两条硬约束（相对路径、候选 URL 必须原样）
- 路径与命名规范 `output/reference/<slug>-<NN>.<ext>`
- 反爬兜底策略
- 与 ComfyUI（img2img / face / inpaint）的衔接方式

### 实测验证

- Wikimedia 搜索页解析出 30+ 图片候选
- 真实下载 960×1466 / 1280×857 JPEG，`file` 命令确认格式
- 参考图直接喂 `comfy_img2img`（denoise 0.5）→ 35.9s 产出 784×1200
