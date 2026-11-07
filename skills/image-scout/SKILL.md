---
name: image-scout
description: Find a real photograph on the public web, download it to disk, and prove it is a real image. Searches Wikimedia Commons and Openverse, follows a page's candidate list, and verifies magic bytes, dimensions and size before handing the file to the rest of the workflow. Use when the user asks to 找一张 xx 的图片 / 找图 / 下载参考图 / 搜几张素材 / 给我真实照片（不是 AI 生成）, or when a ComfyUI img2img, face-swap or inpainting job needs a real source photo.
version: 2.0.0
license: MIT
---

# image-scout

Real photos, not generated ones. Four commands, no API key, no npm dependencies —
the bundled CLI uses only Node.js builtins and works on Windows, macOS and Linux.

## When to use it

- The user wants a real photo or reference image: "find a picture of a red telephone box".
- A ComfyUI workflow needs a source image for `comfy_img2img`, `comfy_face` or `comfy_inpaint`.
- The user wants several candidates to choose from before committing to one.

## When not to use it

- The user wants an **AI-generated** image ("draw me…", "generate an image of…") — use
  `comfyui-local` / `comfy_generate` instead.
- The user already has the image file locally.
- The user needs an icon or vector asset, not a photograph.

## Commands

The host prints this skill's base directory in `<skill_resources>`. Resolve
`scripts/image-scout.mjs` against it; if the shell starts elsewhere, use the absolute
path it printed.

```bash
# 1) Search an archive (Wikimedia Commons by default; Openverse for Flickr-style photos)
node scripts/image-scout.mjs search --query "red telephone box" --limit 8
node scripts/image-scout.mjs search --query "cat portrait" --source openverse --limit 8

# 2) Or harvest candidates from a page you already found
node scripts/image-scout.mjs list \
  --page-url "https://commons.wikimedia.org/w/index.php?search=red+telephone+box&title=Special:MediaSearch&type=image" \
  --limit 20

# 3) Download the one you chose
node scripts/image-scout.mjs download --from search \
  --image-url "https://upload.wikimedia.org/wikipedia/commons/0/07/Red_Telephone_Box_Defibrillator.jpg" \
  --out output/reference/red-telephone-box-01.jpg \
  --license "CC BY-SA 4.0 - Sebastiandoe5"

# 4) Re-check a file that came from anywhere else
node scripts/image-scout.mjs verify --file output/reference/red-telephone-box-01.jpg
```

All commands accept `--json` for machine-readable output, `--proxy <url>`, `--timeout <ms>`,
`--max-bytes <n>`, `--min-bytes <n>` and `--user-agent <text>`.

Network: the CLI uses `IMAGE_SCOUT_PROXY`, then `HTTPS_PROXY` / `HTTP_PROXY`, and nothing
is hard-coded. If the machine needs a proxy and none is exported, pass
`--proxy http://127.0.0.1:7897` explicitly and say so.

## Standard workflow

1. **Search** with a short English query (the archives index English metadata; translate
   the user's term, e.g. 红色电话亭 → "red telephone box"). Prefer Wikimedia for quality and
   clear licensing.
2. **Read the output.** Each result prints title, pixel size, licence, file page and image
   URL. Pick by subject, then resolution — for img2img, 1280 px on the long edge is plenty.
3. **Download** with `--from search` (the URL came from the search API) or `--page-url`
   (the URL came from a page; the CLI re-fetches the page and refuses URLs that are not on
   it). Always pass `--out` inside `output/reference/`.
4. **Check the verdict.** `VERIFY_OK: JPEG 1280x857 294542 bytes` + `SAVED:` means a real
   image is on disk. A `FAIL:` line means nothing was saved.
5. **Report the licence and author** from the search result or the `.json` sidecar, and
   tell the user where the file is.

## Reading the output

| Line | Meaning |
|---|---|
| `SEARCH wikimedia: "…" -> 8 result(s)` | Results follow, one block each |
| `CANDIDATES: 20 (from …)` | `<img>` / `og:image` URLs harvested from the page |
| `VERIFY_OK: JPEG 1280x857 294542 bytes` | Magic bytes, dimensions and size all passed |
| `SAVED: <path>` | File written (sidecar `.json` written unless `--no-sidecar`) |
| `SOURCE: <page>` | Provenance page recorded for the download |
| `REJECT: image_url is not present on …` | URL is not on that page; copy it from the file page or use `--allow-unlisted` |
| `FAIL: …` on stderr | Nothing was saved; fix the reported cause |

Exit codes: `0` ok, `1` usage, `2` network, `3` verification failed, `4` provenance
rejected, `5` policy (private host, bad scheme).

## Source priority

1. **Wikimedia Commons** — `search --source wikimedia`. API-driven, high resolution,
   licence and author in the response. Best default.
2. **Openverse** — `search --source openverse`. Aggregates Flickr and others; more variety,
   but check the licence: `BY-NC` forbids commercial use and `BY-ND` forbids derivatives,
   which matters if the output is going into a product.
3. **Any page** — `list --page-url …` then `download --page-url …`. Works on ordinary
   image pages and gallery pages; falls back to whatever the page embeds (often a
   thumbnail — `list` prints the full-size Wikimedia URL when it can derive it).

If a site blocks plain HTTP requests, use `windows_mcp/Scrape` (or the browser tool) to get
the rendered HTML, save it to a file, and pass `--html-file` to `list`.

## Licences

Every downloaded file gets a `<file>.json` sidecar with source, licence (when supplied) and
dimensions. Keep it: it is the attribution record. Wikimedia Commons files are free to use
but most require attribution — state the author and licence in the final answer. Do not
imply a file is public domain when the result says CC BY-SA.

## Hand-off to ComfyUI

```text
comfy_img2img image=<path> prompt="…" denoise=0.5
comfy_face   face=<portrait path> prompt="…" face_weight=0.85
comfy_inpaint image=<path> mask=<mask path> prompt="…"
```

Use `denoise` 0.25–0.4 to keep the photo's look, 0.55 to restyle, 0.7+ to recompose.

## Naming convention

`output/reference/<subject-slug>-<NN>.<ext>` — e.g. `red-telephone-box-01.jpg`. Number
candidates so a second attempt never overwrites the first.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FAIL: cannot reach … ECONNRESET` / timeout | The host needs a proxy, or the site blocks the request | Pass `--proxy`, or set `HTTPS_PROXY` |
| `HTTP 429` from Openverse | Anonymous rate limit | Wait a minute, lower `--limit`, or use Wikimedia |
| `REJECT: image_url is not present` | The URL is a CDN/redirect variant, or you guessed it | Open the file page, copy its exact image URL, or `--allow-unlisted` when you know the source |
| `magic bytes are not JPEG/PNG/GIF/WEBP` | The server returned an HTML error/consent page | Use the browser tool to fetch, or pick another result |
| `file is only N bytes` | Placeholder or tracking pixel | Pick a larger result; lower `--min-bytes` only for icons |
| `refusing private or loopback host` | SSRF guard | Use a public URL; `--allow-private-hosts` only for trusted LAN sources |
| Dimensions print `?x?` | Unusual JPEG/WEBP header | The file is still valid; confirm with an image tool |

## Hard rules

- Never claim an image was downloaded unless the command printed `SAVED:` and `VERIFY_OK:`.
- Never invent image URLs. Every URL must come from `search`, `list`, or the user.
- Always write into `output/reference/` unless the user asks for another path.
- Always report the licence and author you saw; say "unknown" when the result had none.
- One image per `download` call. For several, call it once per file with distinct `--out`.
