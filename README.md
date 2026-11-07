# image-scout

**Give your agent eyes.** Find a real photograph on the public web, download it, and prove
it is a real image before the rest of your workflow touches it.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4b6bfb)](#install)
[![No API key](https://img.shields.io/badge/API%20key-not%20required-brightgreen)](#)
[![Node](https://img.shields.io/badge/node-22%2B-339933)](package.json)

`image-scout` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin
that bundles one agent skill and one zero-dependency Node.js CLI. It answers the question
agents are bad at: *is this URL actually a photo, and can I trust it?*

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

## What it does

| Command | What it guarantees |
|---|---|
| `search` | Queries the Wikimedia Commons or Openverse API; returns title, pixel size, licence, author, file page and direct image URL |
| `list` | Fetches a page and extracts `<img>`, `srcset` and `og:image` candidates, with the full-size URL when it can derive it |
| `download` | Downloads one URL, **refuses URLs that are not on the declared page**, then checks magic bytes, dimensions and file size before writing |
| `verify` | Re-checks any file on disk with the same three checks |

No daemon, no cache directory, no config file, no API key, no npm dependencies.

## Install

### DeepSeek Harness (the plugin)

```bash
dsh plugin --profile web add dsh-image-scout@2.0.2
```

The registry copy is immutable and ships its own `integrity` metadata, so it installs
cleanly under the `nodeLinker: hoisted` setting DSH profiles use — the failure mode that
bare remote tarball URLs hit does not apply here.

`2.0.2` was published on 2026-11-07 and is `latest`: the registry tarball is 28,461 B
(sha256 `d2af2746…`) and byte-identical to the
[v2.0.2 release asset](https://github.com/2039108952x-lab/image-scout/releases/tag/v2.0.2).
Check it yourself with `npm view dsh-image-scout@2.0.2 dist.integrity`; the release
procedure is documented in [RELEASING.md](RELEASING.md).

Prefer a git checkout? The pinned-tag form works too:

```bash
# Pin a release tag so reinstalls stay reproducible.
dsh plugin --profile web add github:2039108952x-lab/image-scout#v2.0.2
```

Restart the profile (or wait for the skill watcher). The bundle registers a
skill-filesystem provider pointing at its own `skills/` directory, so **`image-scout` is
available immediately** — no copy into `~/.dsh/skills`, no config edit.

Check it loaded:

```bash
dsh --profile web --dump-config | grep image-scout
```

Remove it again with `dsh plugin --profile web remove dsh-image-scout`.

Two environment problems show up on Windows and are worth knowing before you
blame the plugin:

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PNPM_MISSING_TARBALL_INTEGRITY` | DSH profiles set `nodeLinker: hoisted`; pnpm 11.7 writes no `integrity` for a **bare remote tarball URL** and then rejects its own lockfile entry. Only the `add https://…/x.tgz` install form hits this — npm specs, `github:` and local files are unaffected. | Use the npm or `github:` form above, or install a local `.tgz` (see below). |
| `fetch failed` / `ECONNREFUSED` | GitHub needs the proxy | Export it in **lower case** — pnpm and `git ls-remote` read `https_proxy` / `http_proxy`, not the upper-case spelling: `$env:https_proxy='http://127.0.0.1:7897'; $env:http_proxy=$env:https_proxy` |

Local-file fallback (verified on a clean profile): download
`dsh-image-scout-2.0.2.tgz` from the
[release](https://github.com/2039108952x-lab/image-scout/releases/tag/v2.0.2) and run
`dsh plugin --profile web add C:\path\to\dsh-image-scout-2.0.2.tgz`.

**Upgrading from a tarball install?** The v2.0.0 release asset was overwritten twice
(26,733 B → 26,759 B) and has been withdrawn — the tag stays, the asset is gone. An
old lockfile that pinned it records an `integrity` for bytes that no longer exist, so
it keeps working only while pnpm's store holds a copy and fails with an integrity
mismatch as soon as the store is cleared or the machine changes. Reinstall with the
npm or `github:` command above.

### Any other agent

The CLI is the interface; the skill file is the instructions. Both live in
[`skills/image-scout/`](skills/image-scout/):

```bash
git clone https://github.com/2039108952x-lab/image-scout.git
node image-scout/skills/image-scout/scripts/image-scout.mjs search --query "mountain lake" --limit 5
```

- **Claude Code / Codex / Cursor**: point your skill directory at `skills/image-scout/`, or
  copy it into `~/.claude/skills/`.
- **Clients with `web_fetch` + `import_web_image` but no shell** (Reasonix): the original
  tool-native instructions are preserved in [`legacy/reasonix/`](legacy/reasonix/SKILL.md).

> `image-scout` is a community plugin. It is not an official DeepSeek product and is not
> affiliated with Wikimedia or Openverse.

## Quick start

```console
$ image-scout search --query "cat portrait" --source openverse --limit 3
SEARCH openverse: "cat portrait" -> 3 result(s)
  1. Cat portrait  [image 1024x819]
     license: BY-SA 2.0 - solarisgirl
     page:    https://www.flickr.com/photos/7252160@N04/33533092025
     image:   https://live.staticflickr.com/3679/33533092025_a4d3c17e1f_b.jpg
```

Pick a result, download it, keep the sidecar:

```console
$ image-scout download --from search \
    --image-url "https://live.staticflickr.com/3679/33533092025_a4d3c17e1f_b.jpg" \
    --out output/reference/cat-01.jpg --license "BY-SA 2.0 - solarisgirl"
VERIFY_OK: JPEG 1024x819 118343 bytes
SAVED: output/reference/cat-01.jpg
```

If you found the image on a page instead, hand the page in and let the CLI re-check it:

```console
$ image-scout list --page-url "https://commons.wikimedia.org/w/index.php?search=cat&title=Special:MediaSearch&type=image" --limit 5
CANDIDATES: 5 (from https://commons.wikimedia.org/…)
  1. https://upload.wikimedia.org/wikipedia/commons/thumb/…/250px-Cat.jpg
     full: https://upload.wikimedia.org/wikipedia/commons/…/Cat.jpg
     alt:  Cat sitting on a wall

$ image-scout download --page-url "https://commons.wikimedia.org/…" \
    --image-url "https://upload.wikimedia.org/wikipedia/commons/…/Cat.jpg" --out output/reference/cat-02.jpg
```

## Why not just fetch the URL?

Because "downloaded" is not the same as "got an image". A consent wall, a 429 page, a
hotlink-protection redirect and a 250 px thumbnail all return HTTP 200. `download`
therefore checks, in order:

1. **Provenance** — the URL must appear on the page you named (query strings and Wikimedia
   thumb sizes are normalised, so the full-size URL of a listed thumb is accepted).
2. **Magic bytes** — JPEG, PNG, GIF or WEBP signature; an HTML error page never passes.
3. **Dimensions** — parsed from the header (`SOF` for JPEG, `IHDR` for PNG, the frame header
   for GIF/WEBP) without decoding the pixels.
4. **Size floor** — rejects tracking pixels and placeholders below `--min-bytes` (2 KB default).
5. **Atomic write** — temp file + rename, so an interrupted download cannot leave a truncated
   image that later looks valid.

Anything else exits non-zero and writes nothing.

## Sources and licences

| Source | How | Notes |
|---|---|---|
| **Wikimedia Commons** | `--source wikimedia` (default) | Highest resolution, licence + author in the API response, mostly CC |
| **Openverse** | `--source openverse` | Aggregates Flickr and others; check for `NC` (no commercial) and `ND` (no derivatives) |
| **Any page** | `list` + `download --page-url` | Works on gallery and article pages; often only a thumbnail is embedded |

Every download writes `<file>.json` with the source URL, licence (when passed with
`--license`), dimensions and timestamp. Keep it — that is your attribution record. The
image keeps its own licence; MIT here covers the code and the skill text only.

## Layout

```text
image-scout/
├── package.json            # dsh.bundle → cordis.patch.yml
├── cordis.patch.yml        # registers the bundled skills/ directory
├── lib/index.js             # package entry + skill-root resolver
├── skills/image-scout/
│   ├── SKILL.md             # what the agent reads
│   └── scripts/image-scout.mjs   # the CLI (only node: builtins)
├── test/                   # node:test, no network required
├── legacy/reasonix/         # the v1 tool-native skill, kept for web_fetch clients
├── release.json
└── CHANGELOG.md
```

## Requirements

- Node.js 22.19+ or 24+ (the CLI uses `parseArgs`, `fetch`-free `http`-level proxy support
  and native ESM).
- Outbound HTTPS to `commons.wikimedia.org`, `upload.wikimedia.org` and (optionally)
  `api.openverse.org`. Behind a proxy, set `HTTPS_PROXY` or pass `--proxy`.
- No dependencies. `npm install` installs nothing, because there is nothing to install.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cannot reach … ECONNRESET` / timeout | Set `HTTPS_PROXY`, or pass `--proxy http://host:port` |
| `HTTP 429` (Openverse) | Wait a minute, lower `--limit`, or use Wikimedia |
| `REJECT: image_url is not present on …` | Copy the exact URL from the file page, or pass `--allow-unlisted` when you know the source |
| `magic bytes are not JPEG/PNG/GIF/WEBP` | The server returned HTML (consent wall, error page); fetch with a browser and use `--html-file`, or pick another result |
| `refusing private or loopback host` | SSRF guard; use a public URL, or `--allow-private-hosts` for trusted LAN sources |
| Dimensions print `?x?` | Unusual header; the file is still valid, confirm visually |

Run `image-scout --help` for the full flag list; every command accepts `--json`.

## 中文说明

[`README.zh.md`](README.zh.md) — 同样的内容，中文版，面向不想读英文的使用者。

## Contributing

Issues and PRs are welcome. The most useful report is a **failure case**: which page, which
error, what you expected. The test suite runs offline (`npm test`); add a fixture when you
fix an HTML-parsing bug.

## License

MIT © 2026. Images keep the licence their source states.
