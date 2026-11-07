# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] — 2026-11-07

**从"提示词模板"变成"可执行的下载器"。** v1 依赖宿主内建工具；v2 自带一个零依赖 CLI，
任何能跑 Node 的客户端都能用，并且第一次给"下载成功"配了可验证的证据。

### 新增

- `skills/image-scout/scripts/image-scout.mjs`：零依赖 Node CLI（22.19+），四个子命令
  - `search` —— Wikimedia Commons / Openverse API，返回标题、像素尺寸、许可、作者、页面与直链
  - `list` —— 抓页面提候选：`<img>`、`srcset` 全部条目、`og:image`/`twitter:image`，并推导 Wikimedia 原图
  - `download` —— 下载前核对来源、下载后校验，任一项失败不落盘
  - `verify` —— 对任意本地文件复跑魔数 + 尺寸 + 体积检查
- 统一 `--json` 输出、`--license` 备注、`<file>.json` 旁车元数据
- 代理支持：`--proxy` / `IMAGE_SCOUT_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`，
  CONNECT 隧道 + TLS，重试（429/5xx）与指数退避
- SSRF 防护：拒绝 loopback、私网、链路本地与 IPv6 私有前缀，`--allow-private-hosts` 可覆盖
- 退出码约定：`0` 成功、`1` 用法、`2` 网络、`3` 校验、`4` 来源、`5` 策略
- DSH 插件包：`package.json` 声明 `dsh.bundle`，`cordis.patch.yml` 注册自带 `skills/`，
  `lib/index.js` 暴露技能根目录解析
- `test/image-scout.test.mjs` + `test/skill.test.mjs`：25 个离线测试（HTML 解析、魔数、尺寸、来源、SSRF、代理、CLI、skill frontmatter 与版本一致性）
- `.github/workflows/test.yml`：Node 22 / 24 运行测试
- `README.zh.md` 中文 README；`examples/` 换成 v2 真实运行记录

### 变更

- 技能注册名统一为 **`image-scout`**（v1 的根 `SKILL.md` 注册名是 `web-image-finder`）。
  Reasonix 用到的 v1 指令移到 `legacy/reasonix/SKILL.md`。
- `SKILL.md` 迁入 `skills/image-scout/`，正文改为"先跑命令拿到 `SAVED` + `VERIFY_OK`，
  再向用户汇报"的硬规则；禁止凭印象编造图片 URL。
- 下载目录约定收敛为 `output/reference/<slug>-<NN>.<ext>`，与旁车 `<slug>-<NN>.<ext>.json` 成对出现。

### 修复

- HTML 实体（`&amp;`）未解码导致下载 404/403
- 非图片链接（如 `load.php`）混入候选；改为扩展名白名单 + 魔数校验
- `srcset` 只取第一条，导致总是拿到最小图；改为全部条目并去重
- Wikimedia 缩略图主机（`thumb.wikimedia.org`）与原图主机（`upload.wikimedia.org`）不一致，
  导致来源核对误拒；改为按路径归一化
- `--version` 被空位置参数分支吞掉；代理 scheme 非法时静默降级为直连

### 破坏性变更

- v1 的 `web_fetch` / `import_web_image` / `view_image` 调用链不再作为主路径，只在
  `legacy/reasonix/` 保留。升级后请按 README 安装插件，或直接调 `image-scout.mjs`。

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
