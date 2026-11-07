# Real runs

Every block below was copied from an actual terminal session, not written by hand.
Network: Windows 11, `HTTPS_PROXY=http://127.0.0.1:7897` (Wikimedia and Openverse are
not directly reachable from this host). CLI: `v2.0.2` (recorded on 2.0.0; no CLI change since).

Run them yourself with:

```bash
export HTTPS_PROXY=http://127.0.0.1:7897   # omit if you have direct access
node skills/image-scout/scripts/image-scout.mjs search --query "red telephone box" --limit 3
```

---

## 1. Search Wikimedia, download an original

```console
$ image-scout search --query "red telephone box" --limit 3
SEARCH wikimedia: "red telephone box" -> 3 result(s)
  1. File:Red telephone box, St Paul's Cathedral, London, England, GB, IMG 5182 edit.jpg  [JPEG 3608x5509]
     license: CC0 - Christoph Braun
     page:    https://commons.wikimedia.org/wiki/File:Red_telephone_box,_St_Paul%27s_Cathedral,…
     image:   https://upload.wikimedia.org/wikipedia/commons/5/56/Red_telephone_box%2C_St_Paul…

$ image-scout download --from search \
    --image-url "https://upload.wikimedia.org/wikipedia/commons/5/56/Red_telephone_box%2C_St_Paul%27s_Cathedral%2C_London%2C_England%2C_GB%2C_IMG_5182_edit.jpg" \
    --out output/reference/red-telephone-box-01.jpg --license "CC0 - Christoph Braun"
VERIFY_OK: JPEG 3608x5509 14632560 bytes
SAVED: output/reference/red-telephone-box-01.jpg
META: output/reference/red-telephone-box-01.jpg.json
```

The numbers come from the file headers, not from the API: 3,608 × 5,509, 14.6 MB.
`download` re-reads the bytes it wrote and prints `VERIFY_OK` before claiming success.

## 2. Openverse, and a license trap

```console
$ image-scout search --query "cat portrait" --source openverse --limit 3
SEARCH openverse: "cat portrait" -> 3 result(s)
  1. Cat portrait  [image 1024x819]
     license: BY-SA 2.0 - solarisgirl
     page:    https://www.flickr.com/photos/7252160@N04/33533092025
     image:   https://live.staticflickr.com/3679/33533092025_a4d3c17e1f_b.jpg
  2. Sleeping cat  [image 800x600]
     license: BY-NC-ND 2.0 - someone
     …
```

`BY-NC-ND` means **no commercial use and no derivatives**. For a ComfyUI reference image
that will be transformed, that license is a problem — check it before downloading, not after.

## 3. Page → candidates → full-size original

Gallery pages hand out thumbnails. `list` derives the original from a Wikimedia thumbnail
(`…/thumb/5/56/Name.jpg/250px-Name.jpg` → `…/5/56/Name.jpg`) and shows it as `full:`.

```console
$ image-scout list --page-url "https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image" --limit 5
CANDIDATES: 5 (from https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box…)
  1. https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Red_telephone_box%2C_St_Paul…
     full: https://upload.wikimedia.org/wikipedia/commons/5/56/Red_telephone_box%2C_St_Paul…
     alt:  Red telephone box, St Paul's Cathedral, London, England, GB, IMG 5182 edit.jpg
```

Downloading that original with the page URL as provenance check:

```console
$ image-scout download --page-url "https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image" \
    --image-url "https://upload.wikimedia.org/wikipedia/commons/5/56/Red_telephone_box%2C_St_Paul%27s_Cathedral%2C_London%2C_England%2C_GB%2C_IMG_5182_edit.jpg" \
    --out output/reference/red-telephone-box-02.jpg
VERIFY_OK: JPEG 3608x5509 14632560 bytes
SAVED: output/reference/red-telephone-box-02.jpg
META: output/reference/red-telephone-box-02.jpg.json
```

Exit code `0`. Note the URL is the **original**, while the page only contains the
`250px-` thumbnail — the provenance check normalizes both to the same file, so this passes.

## 4. Negative tests (the reason this tool exists)

An image URL that is not on the declared page:

```console
$ image-scout download --page-url "https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image" \
    --image-url "https://upload.wikimedia.org/wikipedia/commons/de/ad/nope.jpg" --out temp/prov-bad.jpg
FAIL: REJECT: image_url is not present on https://commons.wikimedia.org/w/index.php?search=red%20telephone%20box&title=Special:MediaSearch&type=image (40 candidates scanned). Open the file page and copy the exact image URL, or pass --allow-unlisted to override.
$ echo $?
4
```

An HTML page passed off as an image:

```console
$ image-scout download --allow-unlisted \
    --image-url "https://commons.wikimedia.org/wiki/File:Red_Telephone_Box_Defibrillator.jpg" \
    --out temp/html-as-image.jpg
FAIL: downloaded 103797 bytes but magic bytes are not JPEG/PNG/GIF/WEBP (content-type: text/html)
$ echo $?
3
```

Both runs left **no output file**. That is the contract: `SAVED` or nothing.

## 5. A known wrinkle: EXIF orientation

For `Red_Telephone_Box_Defibrillator.jpg`, the API reports `3888x5184` (portrait) while
`VERIFY_OK` printed `JPEG 5184x3888` — the raw JPEG stores landscape dimensions and an EXIF
orientation flag rotates it for display. Both are correct; `image-scout` reports what is in
the bytes, because that is what a downstream tool will actually open. Check the file page if
orientation matters.
