# 实测案例

下面每一条都是在真实会话里跑通并核对过的，不是构造出来的示例。

---

## 案例 1：红色电话亭（三图验证）

**目标**：验证「搜 → 挑 → 下 → 看」全链路，以及搜索结果页与详情页的差异。

### 步骤

**① 搜索页**

```
https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image
```

结果：4,375 条，返回 30+ 个候选。

**② 挑图**，从候选里选了两张：

| alt | 缩略图尺寸 |
|---|---|
| `Red telephone box, St Paul's Cathedral, London, England, GB, IMG 5182 edit.jpg` | 120px |
| `Plants inside red telephone box Bath England.jpg` | 330px |

**③ 高清要先看详情页**

```
https://commons.wikimedia.org/wiki/File:Red_telephone_box,_St_Paul%27s_Cathedral,_London,_England,_GB,_IMG_5182_edit.jpg
```

该页给出 960px / 1920px 候选。原图 3,608×5,509（13.95 MB），授权 **CC0**。

**④ 下载**

```
import_web_image(
  url="https://commons.wikimedia.org/wiki/File:Red_telephone_box,_St_Paul%27s_Cathedral,...",
  image_url="https://thumb.wikimedia.org/.../960px-...?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail",
  path="output/reference/red-telephone-box-01.jpg",
  alt="Red telephone box, St Paul's Cathedral, London"
)
```

返回：`{"width": 960, "height": 1466, "sha256": "99d483c1..."}`

**⑤ 校验**

```
file output/reference/red-telephone-box-01.jpg
→ JPEG image data, baseline, 960x1466, components 3
```

`view_image` 确认是圣保罗大教堂前的 K6 电话亭特写。

### 这一轮踩到的

- 第一次传绝对路径 → `valid relative image path and alt required`
- 第二次自己把 `330px` 改成 `1280px` 拼 URL → `image_url is not an observed image on the source page`
- 第三次用了详情页原样的 URL，但漏了 `utm_campaign=index` → 同样被拒
- 第四次整条复制 → 成功

**结论**：候选 URL 必须逐字符一致。

---

## 案例 2：喂给 ComfyUI

**目标**：验证下载的图能直接作为生成流程的输入。

```python
comfy_img2img(
  image="E:\\ai\\comfy UI\\output\\reference\\red-telephone-box-01.jpg",
  prompt="watercolor painting, red telephone box on a london street, soft palette, loose brush strokes",
  denoise=0.5
)
```

结果：

```
[sdxl_img2img] 完成，用时 35.88s，输出 1 个文件
- image: E:\ai\comfy UI\output\img2img_00002_.png 784x1200
```

输入 960×1466，输出 784×1200，**没有任何格式转换或手工搬运**。

---

## 案例 3：蕾姆（揭示图源的真实边界）

**目标**：找一个动漫角色的图片。

```
https://commons.wikimedia.org/w/index.php?search=Rem%20Re%3AZero&title=Special:MediaSearch&type=image
```

结果：19,450 条——**全部是真人 cosplay**。

选了一张天使装：

```
https://commons.wikimedia.org/wiki/File:RaiRai_as_angel_costume_Rem_at_PF30_20190518b.jpg
```

- 下载：1280×850 JPEG
- 作者：kxz Chen
- 许可：**CC BY-SA 2.0**（需署名 + 衍生同许可）

### 结论

公开版权图库**不会有**官方立绘或动画截图。这类需求只有两条路：

1. 本地生成（同人图，非官方）
2. 走官方/付费渠道

在 skill 里明确写出这一点，比让 Agent 反复试错更有价值。

---

## 案例 4：Openverse（两跳才拿到图）

```bash
curl "https://api.openverse.org/v1/images/?q=red%20telephone%20box&page_size=3"
```

返回 `result_count: 240`，首条：

```json
{
  "title": "Red Telephone boxes",
  "url": "https://live.staticflickr.com/2427/3965304304_965418fffd_b.jpg",
  "license": "by",
  "license_version": "2.0",
  "creator": "Mike Cattell",
  "foreign_landing_url": "https://www.flickr.com/photos/27406286@N05/3965304304"
}
```

`url` 是 Flickr 直链，**不在任何页面上**。必须再抓 `foreign_landing_url` 那一页，
确认直链出现在它的候选里，才能 `import_web_image`。

这就是 README 里说的"两跳"。
