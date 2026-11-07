# legacy

这里放的是 v1 的指令文件，只为**已经装了旧版技能**的客户端保留。

- [`reasonix/SKILL.md`](reasonix/SKILL.md) —— `web-image-finder` 时代（v1.2.0）的技能说明。
  它依赖 Reasonix 的内建工具 `web_fetch` / `import_web_image` / `view_image`，
  在只有 shell 的客户端里**不可用**。

## 该用哪个

| 客户端 | 用这个 |
|---|---|
| DeepSeek Harness | 装插件 `dsh-image-scout`，技能名 `image-scout` |
| 有 shell 的 Agent（Claude Code、Codex、Cursor…） | [`../skills/image-scout/`](../skills/image-scout/) + `scripts/image-scout.mjs` |
| 只有 `web_fetch` / `import_web_image` 的 Reasonix | 本目录 |

v2 的下载校验（来源核对、魔数、尺寸）在 `skills/image-scout/scripts/image-scout.mjs` 里，
不依赖任何宿主工具，所以除 Reasonix 外的客户端都应迁移到 v2。
