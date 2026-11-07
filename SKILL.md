---
name: web-image-finder
description: 在网上找真实图片并下载到本地。当用户要「找一张 xx 的图」「下载参考图」「搜几张素材」「给我真实照片（不是 AI 生成）」时使用。链路是 搜索 → 抓图库页 → 下载 → 校验，下载后可直接喂给 ComfyUI 做图生图/换脸/重绘。
version: 1.1.0
license: MIT
---

# web-image-finder

在**不装任何依赖、不注册任何 API key** 的前提下，从公开图库找到真实图片并落盘。

核心链路只有三步：

```
web_fetch（读页面，拿图片候选） → import_web_image（下载 + 格式校验） → view_image（肉眼确认）
```

## 什么时候用

- 「帮我找一张 XX 的图片 / 照片 / 素材」
- 「下载几张参考图」
- 「要真实的照片，不要 AI 生成的」
- 给 ComfyUI 的 img2img / face / inpaint 准备输入图

## 什么时候不用

| 需求 | 该用什么 |
|---|---|
| 「画一张 XX」 | `comfyui-local` skill（本地出图），不是这里 |
| 「这张图改成 XX 风格」 | 直接 `comfy_img2img`，不需要重新找图 |
| 需要**商用授权明确**的素材 | 优先去 Unsplash / Pexels 官方站（本 skill 的图源授权要逐张核对） |
| 需要**特定版权角色**的官方立绘 | 公开图库基本没有（版权原因），只能走官方渠道或生成 |

## 图源优先级

### ① Wikimedia Commons —— 默认首选

```
https://commons.wikimedia.org/w/index.php?search=<URL编码关键词>&title=Special:MediaSearch&type=image
```

实测：关键词 `red telephone box` → 4,375 条结果，一次 `web_fetch` 拿回 30+ 个候选。

优点：一次跳转就有候选；授权清晰（CC0 / CC BY / CC BY-SA / GFDL）；免 key；无速率限制。

**局限**：搜索结果页只给 **120–330px 缩略图**；纯二次元角色通常只有 cosplay 实拍，没有官方插画。

### ② File 详情页 —— 要高清时走这里

```
https://commons.wikimedia.org/wiki/File:<文件名>
```

File 页会额外给出 960 / 1280 / 1920px 的候选，第一条通常是页面允许的最大可用尺寸。

文件名从搜索结果页候选的 `alt` 字段拿（`alt` 就是文件名）。

### ③ Openverse —— 元数据最全，但需要两跳

```
https://api.openverse.org/v1/images/?q=<关键词>&page_size=20
```

返回字段含 `license`、`license_url`、`attribution`、`creator`、`width/height`，适合需要**先看授权再挑图**的场景。

**必须两跳**：它给的 `url` 是 Flickr 图床直链，不在任何页面上；要先 `web_fetch` 它的 `foreign_landing_url`，
确认直链出现在那页的候选里，才能下载。

### ④ web_search —— 兜底

只在前三个都搜不到时用。返回的多是壁纸站、聚合站，质量参差、反爬多。
如果配置了本地 SearXNG，这一档就是免费的。

## `import_web_image` 的硬约束

这两条**文档里没写，但会直接拒掉请求**：

| 约束 | 报错 | 正确做法 |
|---|---|---|
| `path` 必须是**相对路径** | `valid relative image path and alt required` | 写 `output/reference/xxx.jpg`，不要写 `E:\...` |
| `image_url` 必须是**该 `url` 页面上原样出现的候选** | `image_url is not an observed image on the source page` | 从 `web_fetch` 输出的 `Image candidates` 里**整条复制**，一个字符都别改 |
| `alt` 不能为空 | 同上第一条 | 用候选里的 `alt`，或自己写一句话 |

会导致失败的典型错误：

- 手改尺寸：把 `330px-` 改成 `1280px-` → 页面没这个 URL，拒
- 丢查询参数：去掉 `?utm_campaign=index&utm_content=thumbnail` → 字符串不匹配，拒
- 传绝对路径：`E:\ai\comfy UI\output\...` → 拒

**规律**：`import_web_image` 校验的是"这个 URL 是否真的在这个页面上出现过"，不是"这个 URL 能不能下载"。

## 路径与命名

```
output/reference/<关键词-slug>-<两位序号>.<ext>
```

- 关键词小写英文、空格转连字符：`Red Telephone Box` → `red-telephone-box-01.jpg`
- 序号补零两位，同关键词多张递增
- 扩展名必须与真实格式一致（支持 PNG / JPEG / GIF / WebP，会校验）
- **参考图和 ComfyUI 的产出图分开放**，不要混在 `output/` 根目录

## 标准流程

```
1. web_fetch  搜索页 → 读 Image candidates，按 alt 挑图
2. （可选）web_fetch  File 详情页 → 拿高清候选
3. import_web_image(url=<页面URL>, image_url=<原样候选URL>,
                    path="output/reference/<slug>-01.jpg", alt="<alt>")
4. view_image  确认不是占位图 / 错误页 / 无关图
5. 交付：present_files 给卡片 + 说明来源与许可
   或喂 ComfyUI（相对路径拼成绝对）
```

## 失败模式对照

| 现象 | 原因 | 换法 |
|---|---|---|
| 候选里全是 `.svg` / logo / wordmark | 页面装饰图混进来了 | 按 `alt` 里有没有文件名筛，或换图源 |
| `web_fetch` 只有骨架没有候选 | 页面靠 JS 渲染 | `browser_open(url)` → `browser_read what=snapshot` |
| 403 / Cloudflare 验证页 | 站点反爬 | `windows-mcp/Scrape(url, use_dom=True)` 走真实浏览器 |
| 下载后 `view_image` 是灰图/占位 | 拿到的是占位符 | 换候选；确认 `image_url` 是不是缩略图参数写错了 |
| JSON API 拿不到候选 | `web_fetch` 对 JSON 是原样返回 | 先找到对应的 HTML 落地页 |
| 引擎全 timeout（SearXNG） | 出站没走代理 | 在 `settings.yml` 的 `outgoing.proxies` 配代理 |

**不要**为了绕过反爬去改 UA、伪造 Cookie、爆破接口。换工具或换图源更省事，也更干净。

## 版权与合规

- 每张图**必须看源页面的 license**，不要默认能商用。
- CC BY / CC BY-SA 要求署名，CC BY-SA 还要求衍生作品同许可。
- CC0 / Public Domain 最宽松。
- 角色 cosplay 照片：照片本身有授权，但**角色形象仍是原作方的 IP**，商用风险自负。
- 交付时主动把作者、许可、源链接告诉用户。

## 接 ComfyUI

`import_web_image` 返回的是相对路径，喂 ComfyUI 前拼成绝对路径。

| 用途 | 工具 | 关键参数 |
|---|---|---|
| 换画风 / 保构图重绘 | `comfy_img2img` | `denoise` 0.45–0.55 保主体；0.25–0.40 只调质感 |
| 用这张脸生成 | `comfy_face` | 单人、正脸、脸占画面 ≥1/4、≥512px |
| 改局部 | `comfy_inpaint` | `mask_rect=[x,y,w,h]` 或蒙版图 |

实测：960×1466 的 Wikimedia 照片直接喂 `comfy_img2img(image=..., denoise=0.5)`，
35.9 秒出 784×1200 结果，无需转格式或搬运。

## 交付清单

- [ ] 图在本地，路径明确
- [ ] `view_image` 确认过内容
- [ ] 说明来源（哪个站、哪个页面）
- [ ] 说明许可（CC BY 要署名）
- [ ] 用 `present_files` 给卡片，别只丢路径
