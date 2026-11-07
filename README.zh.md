# image-scout

**给你的 Agent 一双眼睛。** 在公开图库找到真实照片，下载到本地，并在交给后续流程之前证明它确实是一张图。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b6bfb)](#安装)
[![No API key](https://img.shields.io/badge/API%20key-not%20required-brightgreen)](#)

`image-scout` 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，
内含一个 skill 和一个零依赖的 Node.js 命令行工具。它解决的是 Agent 最不擅长的那一步：
**这个 URL 到底是不是一张真图，能不能信。**

```console
$ image-scout search --query "red telephone box" --limit 3
SEARCH wikimedia: "red telephone box" -> 3 result(s)
  1. File:Red telephone box, St Paul's Cathedral, London, England, GB, IMG 5182 edit.jpg  [JPEG 3608x5509]
     license: CC0 - Christoph Braun
     page:    https://commons.wikimedia.org/wiki/File:Red_telephone_box,_St_Paul%27s_Cathedral,…
     image:   https://upload.wikimedia.org/wikipedia/commons/5/56/Red_telephone_box%2C_St_Paul…

$ image-scout download --from search --image-url "https://upload.wikimedia.org/…/Red_Telephone_Box_Defibrillator.jpg" \
    --out output/reference/red-telephone-box-01.jpg --license "CC BY-SA 4.0 - Sebastiandoe5"
VERIFY_OK: JPEG 5184x3888 10160640 bytes
SAVED: output/reference/red-telephone-box-01.jpg
META: output/reference/red-telephone-box-01.jpg.json
```

## 它能做什么

| 命令 | 保证 |
|---|---|
| `search` | 查 Wikimedia Commons / Openverse API，返回标题、像素尺寸、许可、作者、文件页和直链 |
| `list` | 抓一个页面，提取 `<img>`、`srcset`、`og:image` 候选；能推导出原图地址时一并给出 |
| `download` | 下载一个 URL，**拒绝不在声明页面上的 URL**，再校验魔数、尺寸、体积后才落盘 |
| `verify` | 用同样的三重校验复查磁盘上任意文件 |

没有守护进程、没有缓存目录、没有配置文件、不需要 API key、没有 npm 依赖。

## 安装

### DeepSeek Harness（插件方式）

```bash
dsh plugin --profile web add dsh-image-scout@2.0.2
```

registry 上的版本不可变，且带自己的 `integrity` 元数据，所以在 dsh profile 的
`nodeLinker: hoisted` 下能直接装上——裸远程 tarball URL 那个坑不会出现。

想要 git 检出也行，钉 tag 的装法同样可用：

```bash
# 钉住发布 tag，重装结果可复现
dsh plugin --profile web add github:2039108952x-lab/image-scout#v2.0.2
```

重启 profile（或等 skill watcher）。插件会注册一个 skill-filesystem provider 指向自己的
`skills/` 目录，所以 **`image-scout` 立即可用**——不用往 `~/.dsh/skills` 复制，不用改配置。

确认加载：

```bash
dsh --profile web --dump-config | grep image-scout
```

卸载：`dsh plugin --profile web remove dsh-image-scout`。

Windows 上两种环境问题值得先知道，别先怀疑插件：

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_PNPM_MISSING_TARBALL_INTEGRITY` | dsh 的 profile 固定用 `nodeLinker: hoisted`；pnpm 11.7 给**裸远程 tarball URL** 写 lockfile 时不写 `integrity`，随后自己又拒绝这条记录。只有 `add https://…/x.tgz` 这种装法会踩到，npm spec、`github:` 和本地文件都不会。 | 用上面的 npm 或 `github:` 装法，或装本地 `.tgz`（见下）。 |
| `fetch failed` / `ECONNREFUSED` | GitHub 需要代理 | 用**小写**环境变量导出：`$env:https_proxy='http://127.0.0.1:7897'; $env:http_proxy=$env:https_proxy`（pnpm 和 `git ls-remote` 只认小写） |

本地文件兜底（已在干净 profile 验证）：从
[Release](https://github.com/2039108952x-lab/image-scout/releases/tag/v2.0.2) 下载
`dsh-image-scout-2.0.2.tgz`，执行 `dsh plugin --profile web add C:\path\to\dsh-image-scout-2.0.2.tgz`。

**从 tarball 装法升级？** v2.0.0 的 release 资产被覆盖过两次（26,733 B → 26,759 B），
已撤回——tag 保留，资产删除。旧 lockfile 里记录的 `integrity` 对应的是已经不存在的字节，
只靠 pnpm store 里的缓存才能跑；store 一清或换机器就会 integrity mismatch。用上面的
npm 或 `github:` 命令重装即可。

### 其它 Agent

CLI 是接口，SKILL.md 是指令，两者都在 [`skills/image-scout/`](skills/image-scout/)：

```bash
git clone https://github.com/2039108952x-lab/image-scout.git
node image-scout/skills/image-scout/scripts/image-scout.mjs search --query "mountain lake" --limit 5
```

- **Claude Code / Codex / Cursor**：把技能目录指向 `skills/image-scout/`，或复制进 `~/.claude/skills/`。
- **只有 `web_fetch` / `import_web_image`、没有 shell 的客户端**（Reasonix）：v1 的工具式指令保留在
  [`legacy/reasonix/`](legacy/reasonix/SKILL.md)。

> `image-scout` 是社区插件，不是 DeepSeek 官方产品，与 Wikimedia、Openverse 无隶属关系。

## 快速上手

```console
$ image-scout search --query "cat portrait" --source openverse --limit 3
SEARCH openverse: "cat portrait" -> 3 result(s)
  1. Cat portrait  [image 1024x819]
     license: BY-SA 2.0 - solarisgirl
     page:    https://www.flickr.com/photos/7252160@N04/33533092025
     image:   https://live.staticflickr.com/3679/33533092025_a4d3c17e1f_b.jpg

$ image-scout download --from search \
    --image-url "https://live.staticflickr.com/3679/33533092025_a4d3c17e1f_b.jpg" \
    --out output/reference/cat-01.jpg --license "BY-SA 2.0 - solarisgirl"
VERIFY_OK: JPEG 1024x819 118343 bytes
SAVED: output/reference/cat-01.jpg
```

图片是在页面上找到的，就把页面也交给它复核：

```console
$ image-scout list --page-url "https://commons.wikimedia.org/w/index.php?search=cat&title=Special:MediaSearch&type=image" --limit 5
CANDIDATES: 5 (from https://commons.wikimedia.org/…)
  1. https://upload.wikimedia.org/wikipedia/commons/thumb/…/250px-Cat.jpg
     full: https://upload.wikimedia.org/wikipedia/commons/…/Cat.jpg
     alt:  Cat sitting on a wall

$ image-scout download --page-url "https://commons.wikimedia.org/…" \
    --image-url "https://upload.wikimedia.org/wikipedia/commons/…/Cat.jpg" --out output/reference/cat-02.jpg
```

## 为什么不直接抓 URL

因为"下载成功"不等于"拿到图片"。同意页、429 页、防盗链跳转、250px 缩略图，全都返回 HTTP 200。
`download` 因此按顺序检查：

1. **来源**——URL 必须出现在你声明的页面上（query 参数和 Wikimedia 缩略图尺寸会被归一化，
   所以页面上缩略图对应的原图地址也能通过）。
2. **魔数**——JPEG / PNG / GIF / WEBP 签名；HTML 错误页永远过不了。
3. **尺寸**——从文件头解析（JPEG 的 `SOF`、PNG 的 `IHDR`、GIF/WEBP 帧头），不解码像素。
4. **体积下限**——小于 `--min-bytes`（默认 2KB）视为占位图/追踪像素。
5. **原子写入**——先写临时文件再 rename，中断不会留下"看起来正常"的半截图。

任何一项不通过：非零退出，**不写任何文件**。

## 图源与许可

| 图源 | 用法 | 说明 |
|---|---|---|
| **Wikimedia Commons** | `--source wikimedia`（默认） | 分辨率最高，API 直接返回许可与作者，多为 CC |
| **Openverse** | `--source openverse` | 聚合 Flickr 等；注意 `NC`（禁商用）和 `ND`（禁演绎） |
| **任意页面** | `list` + `download --page-url` | 适合画廊页/文章页，但页面里常常只有缩略图 |

每次下载都会写 `<file>.json` 旁车文件，记录来源页、许可（用 `--license` 传入）、尺寸和时间。
留着它——那是署名依据。图片本身适用它源页面的许可，本仓库的 MIT 只覆盖代码和 skill 文本。

## 目录结构

```text
image-scout/
├── package.json            # dsh.bundle → cordis.patch.yml
├── cordis.patch.yml        # 注册自带 skills/ 目录
├── lib/index.js             # 包入口 + skill 根目录解析
├── skills/image-scout/
│   ├── SKILL.md             # Agent 读的指令
│   └── scripts/image-scout.mjs   # CLI（只用 node: 内置模块）
├── test/                   # node:test，不需要联网
├── legacy/reasonix/         # v1 工具式 skill，留给 web_fetch 客户端
├── release.json
└── CHANGELOG.md
```

## 环境要求

- Node.js 22.19+ 或 24+（用到 `parseArgs`、代理支持、原生 ESM）。
- 能访问 `commons.wikimedia.org`、`upload.wikimedia.org`，可选 `api.openverse.org`。
  走代理时设置 `HTTPS_PROXY` 或传 `--proxy`。
- 零依赖：`npm install` 什么都没装，因为本来就没有依赖。

## 常见问题

| 现象 | 处理 |
|---|---|
| `cannot reach … ECONNRESET` / 超时 | 设置 `HTTPS_PROXY`，或传 `--proxy http://host:port` |
| `HTTP 429`（Openverse） | 等一分钟、降低 `--limit`，或改用 Wikimedia |
| `REJECT: image_url is not present on …` | 从文件页复制准确 URL；确认来源时可用 `--allow-unlisted` |
| `magic bytes are not JPEG/PNG/GIF/WEBP` | 服务器返回了 HTML（同意页/错误页）；用浏览器抓 HTML 后走 `--html-file`，或换一张 |
| `refusing private or loopback host` | SSRF 防护；换公网 URL，可信内网才加 `--allow-private-hosts` |
| 尺寸显示 `?x?` | 文件头不常见；图片本身有效，建议肉眼确认 |

完整参数见 `image-scout --help`；所有命令都支持 `--json`。

## 参与

欢迎 issue / PR。最有价值的反馈是**失败案例**：哪个页面、什么报错、你期望什么。
测试完全离线（`npm test`）；修 HTML 解析 bug 时请补一个 fixture。

## License

MIT © 2026。图片授权以各源页面标注为准。
