import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  EXIT,
  assertPublicUrl,
  canonicalImageUrl,
  checkProvenance,
  extractCandidates,
  fullSizeUrl,
  htmlDecode,
  resolveProxy,
  sameResource,
  sniffImage,
  stripTags,
  verifyFile,
} from '../skills/image-scout/scripts/image-scout.mjs';

const CLI = fileURLToPath(new URL('../skills/image-scout/scripts/image-scout.mjs', import.meta.url));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const PAGE_URL = 'https://commons.wikimedia.org/w/index.php?search=red+telephone+box';

const PAGE_HTML = `<!doctype html>
<html><head>
  <meta property="og:image" content="https://example.org/og-cover.gif">
  <meta name="twitter:image" content="/twitter.jpg">
</head><body>
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Red_box%2C_London.jpg/250px-Red_box%2C_London.jpg" alt="Red box">
  <img data-src="/img/photo.png?x=1&amp;y=2" alt="A photo">
  <img srcset="//cdn.example.net/small.webp 1x, //cdn.example.net/large.webp 2x" alt="srcset">
  <img src="//cdn.example.net/small.webp" alt="duplicate">
  <img src="load.php?title=File:Red_box.jpg">
  <img src="data:image/png;base64,iVBORw0KGgo=">
  <img src="https://example.com/vector.svg">
  <img src="relative/photo.jpg">
  <img src="https://example.com/page.html">
</body></html>`;

function jpegBuffer(width, height) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function webpVp8x(width, height) {
  const body = Buffer.alloc(30);
  body.write('RIFF', 0, 'latin1');
  body.writeUInt32LE(22, 4);
  body.write('WEBP', 8, 'latin1');
  body.write('VP8X', 12, 'latin1');
  body.writeUInt32LE(10, 16);
  body[20] = 0;
  body[21] = 0;
  body[22] = 0;
  body[23] = 0;
  body[24] = (width - 1) & 0xff;
  body[25] = ((width - 1) >> 8) & 0xff;
  body[26] = ((width - 1) >> 16) & 0xff;
  body[27] = (height - 1) & 0xff;
  body[28] = ((height - 1) >> 8) & 0xff;
  body[29] = ((height - 1) >> 16) & 0xff;
  return body;
}

/* ------------------------------------------------------------------ */
/* HTML extraction                                                     */
/* ------------------------------------------------------------------ */

test('htmlDecode decodes the entities that hide inside URL attributes', () => {
  assert.equal(htmlDecode('/img/photo.png?x=1&amp;y=2'), '/img/photo.png?x=1&y=2');
  assert.equal(htmlDecode('&quot;quoted&quot; &#65; &#x42;'), '"quoted" A B');
  assert.equal(htmlDecode('no entities here'), 'no entities here');
});

test('stripTags flattens the HTML that Wikimedia puts in author fields', () => {
  assert.equal(stripTags('<a href="https://x">Jane &amp; John</a> <span>CC</span>'), 'Jane & John CC');
});

test('extractCandidates keeps real image URLs and filters noise', () => {
  const candidates = extractCandidates(PAGE_HTML, PAGE_URL);
  const urls = candidates.map((candidate) => candidate.url);

  assert.ok(urls.includes('https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Red_box%2C_London.jpg/250px-Red_box%2C_London.jpg'));
  assert.ok(urls.includes('https://commons.wikimedia.org/img/photo.png?x=1&y=2'), 'relative URL resolved and entity decoded');
  assert.ok(urls.includes('https://cdn.example.net/small.webp'));
  assert.ok(urls.includes('https://cdn.example.net/large.webp'), 'srcset exposes the 2x variant');
  assert.ok(urls.includes('https://example.org/og-cover.gif'), 'og:image is a candidate');
  assert.ok(urls.includes('https://commons.wikimedia.org/twitter.jpg'), 'relative meta image resolved');
  assert.ok(urls.includes('https://commons.wikimedia.org/w/relative/photo.jpg'), 'relative img resolved against the page directory');

  assert.ok(!urls.some((url) => url.includes('load.php')), 'non-image extension filtered');
  assert.ok(!urls.some((url) => url.startsWith('data:')), 'data URIs filtered');
  assert.ok(!urls.some((url) => url.endsWith('.svg')), 'svg filtered');
  assert.ok(!urls.some((url) => url.endsWith('.html')), 'html pages filtered');
  assert.equal(urls.filter((url) => url === 'https://cdn.example.net/small.webp').length, 1, 'duplicates removed');
});

test('extractCandidates exposes the full-size Wikimedia file for a thumb', () => {
  const [candidate] = extractCandidates(PAGE_HTML, PAGE_URL);
  assert.equal(
    candidate.originalUrl,
    'https://upload.wikimedia.org/wikipedia/commons/5/56/Red_box%2C_London.jpg',
  );
});

test('extractCandidates tolerates empty input', () => {
  assert.deepEqual(extractCandidates('', PAGE_URL), []);
  assert.deepEqual(extractCandidates('<p>nothing</p>', PAGE_URL), []);
});

/* ------------------------------------------------------------------ */
/* URL canonicalisation and provenance                                 */
/* ------------------------------------------------------------------ */

test('canonicalImageUrl maps Wikimedia thumbnails to the original file', () => {
  assert.equal(
    canonicalImageUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/A.jpg/120px-A.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/5/56/A.jpg',
  );
  assert.equal(
    canonicalImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/A.jpg/250px-A.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/5/56/A.jpg',
  );
  assert.equal(
    fullSizeUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/A.jpg/250px-A.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/5/56/A.jpg',
  );
  assert.equal(fullSizeUrl('https://live.staticflickr.com/a/b.jpg'), 'https://live.staticflickr.com/a/b.jpg');
});

test('sameResource ignores query strings but not different files', () => {
  assert.ok(sameResource('https://x.test/a.jpg?w=1', 'https://x.test/a.jpg?w=2'));
  assert.ok(!sameResource('https://x.test/a.jpg', 'https://x.test/b.jpg'));
  assert.ok(!sameResource('https://x.test/a.jpg', 'https://y.test/a.jpg'));
});

test('checkProvenance accepts the original URL of a page thumbnail', () => {
  const candidates = extractCandidates(PAGE_HTML, PAGE_URL);
  assert.ok(
    checkProvenance('https://upload.wikimedia.org/wikipedia/commons/5/56/Red_box%2C_London.jpg', candidates),
    'original file is claimed by the thumb on the page',
  );
  assert.ok(checkProvenance('https://cdn.example.net/small.webp', candidates));
  assert.ok(!checkProvenance('https://evil.example.net/not-on-page.jpg', candidates));
});

/* ------------------------------------------------------------------ */
/* Magic bytes + dimensions                                            */
/* ------------------------------------------------------------------ */

test('sniffImage reads JPEG dimensions from the SOF marker', () => {
  const info = sniffImage(jpegBuffer(640, 480));
  assert.deepEqual(info, { format: 'JPEG', mime: 'image/jpeg', width: 640, height: 480 });
});

test('sniffImage reads PNG dimensions', () => {
  const info = sniffImage(PNG_1X1);
  assert.equal(info.format, 'PNG');
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
});

test('sniffImage reads GIF dimensions', () => {
  const info = sniffImage(GIF_1X1);
  assert.deepEqual(info, { format: 'GIF', mime: 'image/gif', width: 1, height: 1 });
});

test('sniffImage reads WEBP VP8X dimensions', () => {
  const info = sniffImage(webpVp8x(800, 600));
  assert.deepEqual(info, { format: 'WEBP', mime: 'image/webp', width: 800, height: 600 });
});

test('sniffImage rejects HTML error pages and short buffers', () => {
  assert.equal(sniffImage(Buffer.from('<!doctype html><html>error</html>')), null);
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff])), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

/* ------------------------------------------------------------------ */
/* URL safety                                                          */
/* ------------------------------------------------------------------ */

test('assertPublicUrl blocks loopback and private targets', () => {
  for (const url of [
    'http://localhost:8080/a.jpg',
    'http://127.0.0.1/a.jpg',
    'http://192.168.1.10/a.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/a.jpg',
    'http://[::1]/a.jpg',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => assertPublicUrl(url), /refusing|unsupported protocol/, url);
  }
  assert.equal(assertPublicUrl('https://commons.wikimedia.org/a.jpg').hostname, 'commons.wikimedia.org');
  assert.ok(assertPublicUrl('http://127.0.0.1/a.jpg', { allowPrivateHosts: true }));
});

/* ------------------------------------------------------------------ */
/* Proxy resolution                                                    */
/* ------------------------------------------------------------------ */

test('resolveProxy honours the flag, the environment, and an explicit opt-out', () => {
  const saved = { ...process.env };
  try {
    process.env.HTTPS_PROXY = 'http://proxy.local:3128';
    process.env.HTTP_PROXY = 'http://proxy.local:3129';
    delete process.env.IMAGE_SCOUT_PROXY;

    assert.equal(resolveProxy('http://flag.local:7897').host, 'flag.local:7897');
    assert.equal(resolveProxy().host, 'proxy.local:3128');
    process.env.IMAGE_SCOUT_PROXY = 'http://scout.local:8080';
    assert.equal(resolveProxy().host, 'scout.local:8080');
    process.env.IMAGE_SCOUT_PROXY = 'none';
    assert.equal(resolveProxy(), null, 'explicit opt-out wins over HTTPS_PROXY');
    assert.throws(() => resolveProxy('socks5://x'), /unsupported proxy scheme/);
  } finally {
    process.env = saved;
  }
});

/* ------------------------------------------------------------------ */
/* verifyFile                                                          */
/* ------------------------------------------------------------------ */

test('verifyFile accepts a real JPEG and rejects a text file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'image-scout-'));
  const good = join(dir, 'good.jpg');
  const bad = join(dir, 'error.html');
  await writeFile(good, jpegBuffer(320, 240));
  await writeFile(bad, '<html><body>429 Too Many Requests</body></html>');

  const ok = await verifyFile(good, { minBytes: 40 });
  assert.equal(ok.ok, true);
  assert.equal(ok.format, 'JPEG');
  assert.equal(ok.width, 320);

  const failed = await verifyFile(bad);
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /not a recognized image/);
  assert.equal(failed.exitCode, EXIT.VERIFY);
});

/* ------------------------------------------------------------------ */
/* CLI contract                                                        */
/* ------------------------------------------------------------------ */

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', IMAGE_SCOUT_PROXY: '', ...env },
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('CLI prints help and version', () => {
  const help = runCli(['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.stdout, /USAGE/);
  assert.match(help.stdout, /image-scout download/);

  const version = runCli(['--version']);
  assert.equal(version.code, EXIT.OK);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const bare = runCli([]);
  assert.equal(bare.code, EXIT.USAGE);
  assert.match(bare.stdout, /USAGE/);
});

test('CLI refuses unknown commands and missing options', () => {
  const unknown = runCli(['frobnicate']);
  assert.equal(unknown.code, EXIT.USAGE);
  assert.match(unknown.stderr, /unknown command/);

  const missing = runCli(['search']);
  assert.equal(missing.code, EXIT.USAGE);
  assert.match(missing.stderr, /missing required option --query/);
});

test('CLI refuses download without provenance and never touches the network', () => {
  const result = runCli(['download', '--image-url', 'https://example.com/a.jpg', '--out', 'x.jpg']);
  assert.equal(result.code, EXIT.USAGE);
  assert.match(result.stderr, /refusing to download a URL with no provenance/);
});

test('CLI reports policy errors as JSON when asked', () => {
  const result = runCli(['download', '--image-url', 'http://127.0.0.1/a.jpg', '--allow-unlisted', '--json']);
  assert.equal(result.code, EXIT.POLICY);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /refusing private or loopback host/);
});

test('CLI verifies a file and exits 3 for a non-image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'image-scout-cli-'));
  const good = join(dir, 'ok.webp');
  const bad = join(dir, 'bad.jpg');
  await writeFile(good, webpVp8x(16, 9));
  await writeFile(bad, Buffer.from('not an image at all, just text'));

  const ok = runCli(['verify', '--file', good, '--min-bytes', '16']);
  assert.equal(ok.code, EXIT.OK, ok.stderr);
  assert.match(ok.stdout, /VERIFY_OK: WEBP 16x9 \d+ bytes/);

  const failed = runCli(['verify', '--file', bad]);
  assert.equal(failed.code, EXIT.VERIFY);
  assert.match(failed.stderr, /VERIFY_FAILED/);
});
