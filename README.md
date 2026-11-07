# web-image-finder

> 让 AI Agent 在**不装任何依赖、不注册任何 API key** 的前提下，从公开图库找到真实图片并保存到本地。

一个面向 MCP / Agent 的 **skill**（技能包）：把「搜索 → 拿候选 → 下载 → 校验」这条链路固化成可复用的指令，
让 Agent 不用每次现搓代码，也不会再踩同样的坑。

---

## 它解决什么问题

Agent 要"找一张图片"时，常见的三种做法都有代价：

| 做法 | 问题 |
|---|---|
| 调 Unsplash / Pexels API | 要注册 key、有配额、图源单一 |
| 爬搜索引擎图片结果 | 反爬、防盗链、拿到的常是缩略图或占位图 |
| 让模型自己写爬虫 | 每个会话重写一遍，坑重踩一遍 |

这个 skill 换了个思路：**不自己抓图，而是让 Agent 去读图库的搜索结果页**。

`web_fetch` 这类工具本来就会把 HTML 归约成文本，同时把页面里的图片提取成候选列表；
`import_web_image` 再做一次"这图是不是真在这页上"的校验，然后落盘。

结果就是：**零依赖、零 key、授权信息随页面一起拿到**。

---

## 核心链路

```
web_fetch（读页面 → 输出 Image candidates）
      ↓
import_web_image（校验候选真实性 + 格式，落盘）
      ↓
view_image（确认不是占位图）
```

三步之外没有隐藏步骤。没有 daemon、没有数据库、没有缓存目录。

---

## 快速开始

### 前提

你的 Agent 需要具备三个能力（名字可能不同，功能对得上即可）：

| 能力 | 作用 | 同类工具 |
|---|---|---|
| 读网页 | 抓 HTML 并提取图片候选 | `web_fetch` / `fetch` / `Scrape` |
| 下载图片 | 校验并保存到本地 | `import_web_image` |
| 看图 | 确认下到的是不是想要的 | `view_image` / vision 模型 |

### 安装

把 `SKILL.md` 放进你 Agent 的技能目录即可。

**Reasonix**

```bash
cp -r web-image-finder "%APPDATA%\reasonix\skills\"
# 或加进 config.toml
# [skills]
# paths = ["<你的 skills 目录>"]
```

**Claude Code / 其它支持 skills 的客户端**

```bash
cp -r web-image-finder ~/.claude/skills/
```

**不支持的客户端**：直接把 `SKILL.md` 的内容贴进系统提示词或项目说明文件（如 `AGENTS.md`），
它本质就是一份可执行的指令，不依赖特定平台。

### 第一次使用

对 Agent 说：

```
帮我找一张红色电话亭的图片
```

Agent 应该：

1. 抓 `https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image`
2. 从返回的 `Image candidates` 里挑一张
3. `import_web_image(url=..., image_url=..., path="output/reference/red-telephone-box-01.jpg", alt=...)`
4. `view_image` 确认
5. 把图和许可信息一起给你

---

## 图源

| 图源 | 一跳到位 | 授权清晰 | 免 key | 高清 | 适合 |
|---|:---:|:---:|:---:|:---:|---|
| **Wikimedia Commons** | ✅ | ✅ | ✅ | 需进 File 页 | 通用首选、地标/人物/物件 |
| **Openverse** | ❌ 两跳 | ✅✅ | ✅ | 取决原站 | 需要先看 license 再挑 |
| **web_search 兜底** | ❌ | ❌ | 取决后端 | 不稳 | 前两个搜不到时 |

### Wikimedia Commons

```
https://commons.wikimedia.org/w/index.php?search=<URL编码关键词>&title=Special:MediaSearch&type=image
```

一次抓取拿到 30+ 候选。缩略图只有 120–330px，要高清得再进 File 详情页。

### Openverse

```
https://api.openverse.org/v1/images/?q=<关键词>&page_size=20
```

返回 `license` / `license_url` / `attribution` / `creator` / `width` / `height`，
是目前授权信息最完整的免费图源。代价是 API 给的直链不在任何页面上，下载要多跳一次。

---

## 已踩过的坑（这也是这个 skill 存在的主要价值）

### `import_web_image` 只认"页面上真实出现过的 URL"

不是"能下载就行"，而是"这个字符串必须在这个页面的候选里出现过"。

- 把 `330px-` 手改成 `1280px-` → `image_url is not an observed image on the source page`
- 去掉 `?utm_campaign=index&utm_content=thumbnail` → 同样被拒
- `path` 传绝对路径 → `valid relative image path and alt required`

正确做法只有一个：**从 `web_fetch` 输出的 `Image candidates` 里整条复制**。

### 搜索结果页 ≠ 高清

Wikimedia 的 MediaSearch 结果页给的是缩略图。想要 960/1280/1920px，
必须再抓一次 `File:` 详情页，用那一页给出的候选。

### 动漫角色基本只有 cosplay

公开图库对版权敏感，Re:Zero、原神这类角色的**官方立绘和动画截图不会出现在 Wikimedia**。
能搜到的绝大多数是 cosplay 实拍。这不是工具的问题，是版权现实。

---

## 和 ComfyUI 串联

下载的图可以直接作为本地生成流程的输入：

```python
comfy_img2img(image="E:\\ai\\comfy UI\\output\\reference\\rem-01.jpg",
              prompt="watercolor painting, soft palette",
              denoise=0.5)
```

实测：960×1466 的照片直接喂 `comfy_img2img`，35.9 秒出 784×1200 结果，无需转格式。

支持的衔接方式：

| 用途 | 工具 | 要点 |
|---|---|---|
| 换画风 / 保构图 | `comfy_img2img` | denoise 0.45–0.55 |
| 用这张脸生成 | `comfy_face` | 正脸、脸占画面 ≥1/4、≥512px |
| 改局部 | `comfy_inpaint` | `mask_rect=[x,y,w,h]` |

---

## 目录结构

```
web-image-finder/
├── SKILL.md            # 给 Agent 读的可执行指令（核心）
├── README.md           # 本文件，给人读
├── LICENSE             # MIT
├── CHANGELOG.md        # 版本记录
└── examples/
    └── README.md       # 实测案例与真实 URL
```

`SKILL.md` 是真正被 Agent 加载的部分，其余是给人看的。

---

## 设计取舍

**为什么不做成可执行脚本？**

因为"找图"的难点不在下载，在**判断**：挑哪张、许可是什么、什么时候该换源。
这些判断只有模型能做，写死成脚本反而失去灵活性。

**为什么不内置图源列表？**

图源会变、会挂、会加反爬。skill 只固化了**策略**（先哪后哪、失败了怎么换），
具体 URL 每次现拼，反而更抗变化。

**为什么强调 `view_image` 校验？**

因为反爬页面、付费墙、防盗链都会让"下载成功"变成一个假象。看到的才算数。

---

## 已知限制

- 需要 Agent 本身具备网页抓取和图片导入能力，纯文本模型用不了
- Wikimedia 的摄影作品质量参差，不是图库级审美
- Openverse 的部分图源（Flickr）需要两跳，慢
- 不处理登录态、付费墙、验证码
- 不保证图片的肖像权 / 商标权，商用需自行评估

---

## License

MIT © 2026

图片本身不适用本仓库的许可——每张图的授权以它源页面标注的为准。
