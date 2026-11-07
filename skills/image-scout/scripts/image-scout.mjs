#!/usr/bin/env node
/**
 * image-scout — find real photos on the public web, download one, and verify it.
 *
 * Zero dependencies. Node.js 22+ (uses only node: builtins).
 *
 *   image-scout search   --query "red telephone box" [--source wikimedia|openverse] [--limit 20]
 *   image-scout list     --page-url <page> [--html-file <file>] [--limit 40]
 *   image-scout download --image-url <url> (--page-url <page> | --from search | --allow-unlisted) --out <file>
 *   image-scout verify   --file <path>
 *
 * Every command accepts --proxy, --json, --timeout, --user-agent and prints a
 * one-line machine-readable verdict (VERIFY_OK / REJECT / FAIL) on stdout.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import tls from 'node:tls';
import { parseArgs } from 'node:util';

export const VERSION = '2.0.0';

const DEFAULT_UA = `image-scout/${VERSION} (+https://github.com/2039108952x-lab/image-scout)`;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MIN_BYTES = 2_000;
const MAX_REDIRECTS = 5;

export const EXIT = {
  OK: 0,
  USAGE: 1,
  NETWORK: 2,
  VERIFY: 3,
  REJECT: 4,
  POLICY: 5,
};

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export class ScoutError extends Error {
  constructor(message, exitCode = EXIT.USAGE, details = {}) {
    super(message);
    this.name = 'ScoutError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  copy: '\u00a9',
  middot: '\u00b7',
};

/** Decode the HTML entities that actually show up inside URL attributes. */
export function htmlDecode(input) {
  if (typeof input !== 'string' || input.indexOf('&') === -1) return input;
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Remove tags and collapse whitespace, for licence/author fields that contain HTML. */
export function stripTags(input) {
  return htmlDecode(String(input ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function requireOption(values, key) {
  const value = values[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ScoutError(`missing required option --${key}`, EXIT.USAGE, { option: key });
  }
  return value.trim();
}

function positiveInt(raw, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ScoutError(`expected a positive integer, got ${JSON.stringify(raw)}`, EXIT.USAGE);
  }
  return Math.min(value, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Proxy + HTTP                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the proxy to use. Explicit flag wins, then IMAGE_SCOUT_PROXY, then
 * the conventional HTTPS_PROXY / HTTP_PROXY environment variables.
 * Nothing is hard-coded: a machine without a proxy works with no configuration.
 */
export function resolveProxy(explicit) {
  const raw =
    explicit ||
    process.env.IMAGE_SCOUT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (raw === undefined || /^\s*(none|direct|off)\s*$/i.test(raw) || raw.trim() === '') return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ScoutError(`unsupported proxy scheme ${url.protocol} (expected http:// or https://)`, EXIT.USAGE);
    }
    return url;
  } catch (error) {
    if (error instanceof ScoutError) throw error;
    throw new ScoutError(`invalid proxy URL: ${raw}`, EXIT.USAGE);
  }
}

function proxyAuthHeader(proxy) {
  if (!proxy.username) return null;
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/** Open a CONNECT tunnel through an HTTP proxy. */
function connectTunnel(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${host}:${port}` };
    const auth = proxyAuthHeader(proxy);
    if (auth) headers['Proxy-Authorization'] = auth;
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      agent: false,
    });
    req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new ScoutError('proxy CONNECT timed out', EXIT.NETWORK)));
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new ScoutError(`proxy refused CONNECT (HTTP ${res.statusCode})`, EXIT.NETWORK));
        return;
      }
      resolve(socket);
    });
    req.once('error', (error) => reject(new ScoutError(`proxy CONNECT failed: ${error.message}`, EXIT.NETWORK)));
    req.end();
  });
}

function collectBody(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    res.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy();
        reject(new ScoutError(`response exceeds --max-bytes (${maxBytes})`, EXIT.VERIFY));
        return;
      }
      chunks.push(chunk);
    });
    res.once('end', () => resolve(Buffer.concat(chunks)));
    res.once('error', (error) => reject(new ScoutError(`response failed: ${error.message}`, EXIT.NETWORK)));
  });
}

async function requestOnce(target, { method = 'GET', headers = {}, timeoutMs, proxy, maxBytes }) {
  const host = target.hostname;
  const isHttps = target.protocol === 'https:';
  const port = Number(target.port) || (isHttps ? 443 : 80);
  const requestHeaders = {
    'User-Agent': DEFAULT_UA,
    Accept: '*/*',
    'Accept-Language': 'en;q=0.8,zh-CN;q=0.6',
    Connection: 'close',
    ...headers,
    Host: target.host,
  };

  let req;
  if (!proxy) {
    const mod = isHttps ? https : http;
    req = mod.request(target, { method, headers: requestHeaders, agent: false });
  } else if (!isHttps) {
    const auth = proxyAuthHeader(proxy);
    req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method,
      path: target.href,
      headers: { ...requestHeaders, ...(auth ? { 'Proxy-Authorization': auth } : {}) },
      agent: false,
    });
  } else {
    const socket = await connectTunnel(proxy, host, port);
    const secure = tls.connect({ socket, servername: host });
    await once(secure, 'secureConnect');
    // HTTP over an already-established TLS socket: the http module only needs
    // to write plaintext into it, so a one-shot agent hands it the TLS socket.
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = () => secure;
    req = http.request({
      host,
      port,
      method,
      path: `${target.pathname}${target.search}`,
      headers: requestHeaders,
      agent,
    });
  }

  req.setTimeout(timeoutMs, () => {
    req.destroy(new ScoutError(`request timed out after ${timeoutMs} ms: ${target.href}`, EXIT.NETWORK));
  });

  req.end();
  let res;
  try {
    [res] = await once(req, 'response');
  } catch (error) {
    throw error instanceof ScoutError
      ? error
      : new ScoutError(`cannot reach ${target.host}: ${error.message}`, EXIT.NETWORK);
  }
  const body = method === 'HEAD' ? Buffer.alloc(0) : await collectBody(res, maxBytes);
  return { status: res.statusCode, headers: res.headers, body, url: target.href };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function retryDelay(response, attempt) {
  const header = response?.headers?.['retry-after'];
  const seconds = header === undefined ? Number.NaN : Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.min(seconds, 10) * 1000;
  return Math.min(500 * 2 ** attempt, 8_000);
}

/** GET with retries. */
async function httpGet(url, options) {
  const target = new URL(url);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await requestOnce(target, { ...options, method: 'GET' });
      if (response.status >= 200 && response.status < 300) return response;
      if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (response.status === 404) {
        throw new ScoutError(`HTTP 404 Not Found: ${target.href}`, EXIT.NETWORK);
      }
      throw new ScoutError(`HTTP ${response.status} from ${target.host}: ${target.pathname}`, EXIT.NETWORK);
    } catch (error) {
      lastError = error;
      if (error instanceof ScoutError && error.exitCode !== EXIT.NETWORK) throw error;
      if (attempt === 2) break;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError instanceof ScoutError
    ? lastError
    : new ScoutError(`cannot fetch ${target.href}: ${lastError?.message ?? 'unknown error'}`, EXIT.NETWORK);
}

/** GET following redirects, rejecting unsafe hosts on every hop. */
export async function fetchUrl(url, { allowPrivateHosts = false, onRedirect, ...options } = {}) {
  let current = new URL(url);
  const seen = new Set();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertPublicUrl(current, { allowPrivateHosts });
    if (seen.has(current.href)) throw new ScoutError(`redirect loop at ${current.href}`, EXIT.NETWORK);
    seen.add(current.href);
    const response = await httpGet(current, options);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new ScoutError(`HTTP ${response.status} without Location`, EXIT.NETWORK);
      const next = new URL(location, current);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new ScoutError(`refusing redirect to ${next.protocol}`, EXIT.POLICY);
      }
      onRedirect?.(next);
      current = next;
      continue;
    }
    return response;
  }
  throw new ScoutError(`too many redirects starting at ${url}`, EXIT.NETWORK);
}

/* ------------------------------------------------------------------ */
/* URL safety                                                          */
/* ------------------------------------------------------------------ */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.home\.arpa$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
  /^::1$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

/** Refuse obviously local targets so a hostile page cannot turn the CLI into an SSRF tool. */
export function assertPublicUrl(url, { allowPrivateHosts = false } = {}) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ScoutError(`unsupported protocol ${parsed.protocol}`, EXIT.POLICY);
  }
  if (allowPrivateHosts) return parsed;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new ScoutError(
      `refusing private or loopback host ${host} (pass --allow-private-hosts to override)`,
      EXIT.POLICY,
    );
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* HTML candidate extraction                                           */
/* ------------------------------------------------------------------ */

const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp)$/i;

/**
 * Wikimedia serves scaled copies as
 *   https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Name.jpg/250px-Name.jpg
 * while the full-resolution original lives at
 *   https://upload.wikimedia.org/wikipedia/commons/5/56/Name.jpg
 * Canonicalising both forms keeps provenance checks honest and lets `list` show
 * the full-size URL for a page that only embeds thumbnails.
 */
function wikiOriginal(pathname) {
  const thumb = pathname.match(/^(\/wikipedia\/[^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)\/[^/]+$/);
  if (!thumb) return null;
  // Scaled copies may be served from thumb.wikimedia.org; the original always
  // lives on upload.wikimedia.org.
  return `https://upload.wikimedia.org${thumb[1]}/${thumb[2]}/${thumb[3]}`;
}

export function canonicalImageUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    return wikiOriginal(url.pathname) ?? `${url.origin}${url.pathname}`;
  } catch {
    return String(raw);
  }
}

/** The full-resolution URL for a Wikimedia thumbnail, otherwise the URL unchanged. */
export function fullSizeUrl(raw) {
  try {
    const url = new URL(raw);
    return wikiOriginal(url.pathname) ?? url.href;
  } catch {
    return String(raw);
  }
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = htmlDecode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function srcsetUrls(srcset) {
  // "a.jpg 1x, b.jpg 2x" -> [a.jpg, b.jpg]
  return srcset
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter((entry) => typeof entry === 'string' && entry !== '');
}

/**
 * Pull candidate image URLs out of an HTML page. Accepts <img src|data-src|srcset>,
 * and og:image / twitter:image meta tags. Keeps only http(s) URLs whose path looks
 * like an image, de-duplicated.
 */
export function extractCandidates(html, pageUrl) {
  const results = [];
  const seen = new Set();

  const add = (raw, alt = '', origin = 'img') => {
    if (typeof raw !== 'string') return;
    let value = raw.trim();
    if (value === '' || /^(data|blob|javascript|mailto):/i.test(value)) return;
    let absolute;
    try {
      absolute = new URL(value, pageUrl);
    } catch {
      return;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return;
    absolute.hash = '';
    if (!IMAGE_PATH.test(absolute.pathname)) return;
    if (seen.has(absolute.href)) {
      const existing = results.find((item) => item.url === absolute.href);
      if (existing && existing.alt === '' && alt !== '') existing.alt = alt;
      return;
    }
    seen.add(absolute.href);
    const full = fullSizeUrl(absolute.href);
    results.push({
      url: absolute.href,
      alt: alt.trim(),
      origin,
      ...(full !== absolute.href ? { originalUrl: full } : {}),
    });
  };

  for (const match of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const alt = attributes.alt ?? '';
    if (attributes.srcset) {
      for (const srcsetUrl of srcsetUrls(attributes.srcset)) add(srcsetUrl, alt, 'srcset');
    }
    for (const key of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-image']) {
      if (attributes[key]) add(attributes[key], alt, 'img');
    }
  }

  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') {
      add(attributes.content ?? '', '', 'meta');
    }
  }

  return results;
}

/** True when two URLs point at the same resource; query strings and Wikimedia thumb sizes may differ. */
export function sameResource(a, b) {
  try {
    const left = canonicalImageUrl(a);
    const right = canonicalImageUrl(b);
    return left === right;
  } catch {
    return false;
  }
}

export function checkProvenance(imageUrl, candidates) {
  const wanted = canonicalImageUrl(imageUrl);
  return candidates.some(
    (candidate) => canonicalImageUrl(candidate.url) === wanted || (candidate.originalUrl && canonicalImageUrl(candidate.originalUrl) === wanted),
  );
}

/* ------------------------------------------------------------------ */
/* Image sniffing                                                      */
/* ------------------------------------------------------------------ */

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

/**
 * Identify the image format from magic bytes and read its dimensions without
 * decoding the pixels. Returns null when the buffer is not a supported image.
 */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;

  // PNG: signature + IHDR
  if (
    buffer[0] === 0x89 &&
    buffer.toString('latin1', 1, 4) === 'PNG' &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { format: 'PNG', mime: 'image/png', width, height };
  }

  // GIF: GIF87a / GIF89a, little-endian canvas size
  const header = buffer.toString('latin1', 0, 6);
  if (header === 'GIF87a' || header === 'GIF89a') {
    return { format: 'GIF', mime: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // JPEG: walk markers until a Start Of Frame carries the dimensions
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const length = buffer.readUInt16BE(offset + 2);
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        return {
          format: 'JPEG',
          mime: 'image/jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
    return { format: 'JPEG', mime: 'image/jpeg', width: null, height: null };
  }

  // WEBP: RIFF container, VP8X / VP8 / VP8L chunk
  if (buffer.length >= 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('latin1', 12, 16);
    if (chunk === 'VP8X') {
      return { format: 'WEBP', mime: 'image/webp', width: 1 + readUInt24LE(buffer, 24), height: 1 + readUInt24LE(buffer, 27) };
    }
    if (chunk === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { format: 'WEBP', mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return {
        format: 'WEBP',
        mime: 'image/webp',
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    return { format: 'WEBP', mime: 'image/webp', width: null, height: null };
  }

  return null;
}

/** Verify a file on disk: magic bytes, dimensions, size floor. */
export async function verifyFile(path, { minBytes = DEFAULT_MIN_BYTES } = {}) {
  let info;
  try {
    info = await stat(path);
  } catch {
    return { ok: false, reason: `no such file: ${path}`, exitCode: EXIT.USAGE };
  }
  if (!info.isFile()) return { ok: false, reason: `not a regular file: ${path}`, exitCode: EXIT.USAGE };
  const buffer = await readFile(path);
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    return {
      ok: false,
      reason: 'not a recognized image (magic bytes do not match JPEG/PNG/GIF/WEBP)',
      exitCode: EXIT.VERIFY,
      bytes: info.size,
    };
  }
  if (info.size < minBytes) {
    return {
      ok: false,
      reason: `file is only ${info.size} bytes (minimum ${minBytes}); likely an error page or placeholder`,
      exitCode: EXIT.VERIFY,
      bytes: info.size,
      ...sniffed,
    };
  }
  return { ok: true, bytes: info.size, ...sniffed };
}

/* ------------------------------------------------------------------ */
/* Search providers                                                    */
/* ------------------------------------------------------------------ */

function metaValue(extmetadata, key) {
  const entry = extmetadata?.[key];
  return entry && typeof entry.value === 'string' ? stripTags(entry.value) : '';
}

async function searchWikimedia(query, { limit, ...options }) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
  }).toString();

  const response = await fetchUrl(url.href, options);
  const payload = JSON.parse(response.body.toString('utf8'));
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  if (pages.length === 0) {
    const warning = payload?.warnings?.main?.warnings ?? payload?.warnings?.query?.warnings;
    if (warning) throw new ScoutError(`Wikimedia API warning: ${stripTags(String(warning))}`, EXIT.NETWORK);
  }

  return pages
    .map((page) => {
      const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info || !MIME_EXT[info.mime]) return null;
      return {
        source: 'wikimedia',
        title: page.title ?? '',
        pageUrl: info.descriptionurl ?? '',
        imageUrl: info.url ?? '',
        previewUrl: info.thumburl ?? '',
        width: info.width ?? null,
        height: info.height ?? null,
        bytes: info.size ?? null,
        mime: info.mime,
        license: metaValue(info.extmetadata, 'LicenseShortName'),
        licenseUrl: metaValue(info.extmetadata, 'LicenseUrl'),
        author: metaValue(info.extmetadata, 'Artist'),
        credit: metaValue(info.extmetadata, 'Credit'),
      };
    })
    .filter(Boolean);
}

async function searchOpenverse(query, { limit, ...options }) {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.search = new URLSearchParams({
    q: query,
    page_size: String(Math.min(limit, 100)),
    license_type: 'all',
  }).toString();

  let response;
  try {
    response = await fetchUrl(url.href, options);
  } catch (error) {
    if (error?.exitCode === EXIT.NETWORK && /\b429\b/.test(error.message)) {
      throw new ScoutError(
        'Openverse rate limit reached (HTTP 429); wait a minute, lower --limit, or use --source wikimedia',
        EXIT.NETWORK,
      );
    }
    throw error;
  }

  const payload = JSON.parse(response.body.toString('utf8'));
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .filter((item) => typeof item?.url === 'string' && item.url !== '')
    .map((item) => ({
      source: 'openverse',
      title: stripTags(item.title ?? ''),
      pageUrl: item.foreign_landing_url ?? '',
      imageUrl: item.url,
      previewUrl: item.thumbnail ?? '',
      width: item.width ?? null,
      height: item.height ?? null,
      bytes: item.filesize ?? null,
      mime: null,
      license: [item.license, item.license_version].filter(Boolean).join(' ').toUpperCase(),
      licenseUrl: item.license_url ?? '',
      author: stripTags(item.creator ?? ''),
      credit: stripTags(item.attribution ?? ''),
    }));
}

export async function searchImages(query, { source = 'wikimedia', limit = 20, ...options } = {}) {
  const wanted = String(source).toLowerCase();
  if (wanted === 'wikimedia' || wanted === 'commons') {
    return searchWikimedia(query, { limit, ...options });
  }
  if (wanted === 'openverse') return searchOpenverse(query, { limit, ...options });
  if (wanted === 'all') {
    const [wikimedia, openverse] = await Promise.all([
      searchWikimedia(query, { limit, ...options }).catch((error) => {
        if (process.env.IMAGE_SCOUT_DEBUG) console.error(`openverse skipped: ${error.message}`);
        return [];
      }),
      searchOpenverse(query, { limit, ...options }).catch((error) => {
        if (process.env.IMAGE_SCOUT_DEBUG) console.error(`openverse skipped: ${error.message}`);
        return [];
      }),
    ]);
    return [...wikimedia, ...openverse].slice(0, limit);
  }
  throw new ScoutError(`unknown --source ${source} (use wikimedia, openverse or all)`, EXIT.USAGE);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

async function cmdSearch(values) {
  const query = requireOption(values, 'query');
  const source = values.source ?? 'wikimedia';
  const limit = positiveInt(values.limit, 20, 100);
  const options = httpOptions(values);
  const results = await searchImages(query, { source, limit, ...options });

  if (results.length === 0) {
    throw new ScoutError(`no images found for ${JSON.stringify(query)} on ${source}`, EXIT.NETWORK);
  }

  if (values.json) {
    return {
      action: 'search',
      source,
      query,
      limit,
      count: results.length,
      results,
      message: `${results.length} result(s) for ${JSON.stringify(query)} on ${source}`,
    };
  }
  const lines = [`SEARCH ${source}: ${JSON.stringify(query)} -> ${results.length} result(s)`];
  results.forEach((item, index) => {
    const size = item.width && item.height ? `${item.width}x${item.height}` : 'unknown size';
    const mime = item.mime ? item.mime.replace('image/', '').toUpperCase() : 'image';
    lines.push(`${String(index + 1).padStart(3)}. ${item.title || '(untitled)'}  [${mime} ${size}]`);
    if (item.license || item.author) {
      lines.push(`     license: ${[item.license, item.author].filter(Boolean).join(' - ')}`);
    }
    lines.push(`     page:    ${item.pageUrl}`);
    lines.push(`     image:   ${item.imageUrl}`);
  });
  lines.push('', 'NEXT: download the one you want with --image-url, or open a page URL to get more sizes.');
  return { action: 'search', source, query, count: results.length, results, lines };
}

async function cmdList(values) {
  const pageUrl = requireOption(values, 'page-url');
  const limit = positiveInt(values.limit, 40, 500);
  const options = httpOptions(values);

  let html;
  let fetchedFrom = pageUrl;
  if (values['html-file']) {
    html = await readFile(resolvePath(values['html-file']), 'utf8');
    fetchedFrom = `file://${resolvePath(values['html-file'])}`;
  } else {
    const response = await fetchUrl(pageUrl, options);
    html = response.body.toString('utf8');
  }

  const candidates = extractCandidates(html, pageUrl).slice(0, limit);
  if (candidates.length === 0) {
    throw new ScoutError(
      `no image candidates found on ${fetchedFrom}; try another page or pass --html-file with the rendered HTML`,
      EXIT.NETWORK,
    );
  }

  if (values.json) {
    return {
      action: 'list',
      pageUrl,
      fetchedFrom,
      count: candidates.length,
      candidates,
      message: `${candidates.length} candidate(s) on ${pageUrl}`,
    };
  }
  const lines = [`CANDIDATES: ${candidates.length} (from ${fetchedFrom})`];
  candidates.forEach((candidate, index) => {
    lines.push(`${String(index + 1).padStart(3)}. ${candidate.url}`);
    if (candidate.originalUrl) lines.push(`     full: ${candidate.originalUrl}`);
    if (candidate.alt) lines.push(`     alt:  ${candidate.alt.slice(0, 120)}`);
  });
  lines.push('', 'NEXT: download one with --page-url and --image-url (the full-size URL is accepted too).');
  return { action: 'list', pageUrl, fetchedFrom, count: candidates.length, candidates, lines };
}

async function cmdDownload(values) {
  const imageUrl = requireOption(values, 'image-url');
  const pageUrl = values['page-url'];
  const from = (values.from ?? '').toLowerCase();
  const allowUnlisted = Boolean(values['allow-unlisted']);

  assertPublicUrl(imageUrl, { allowPrivateHosts: Boolean(values['allow-private-hosts']) });

  if (pageUrl) {
    assertPublicUrl(pageUrl, { allowPrivateHosts: Boolean(values['allow-private-hosts']) });
    const page = await fetchUrl(pageUrl, httpOptions(values));
    const candidates = extractCandidates(page.body.toString('utf8'), pageUrl);
    if (!checkProvenance(imageUrl, candidates) && !allowUnlisted) {
      throw new ScoutError(
        `REJECT: image_url is not present on ${pageUrl} (${candidates.length} candidates scanned). ` +
          'Open the file page and copy the exact image URL, or pass --allow-unlisted to override.',
        EXIT.REJECT,
      );
    }
  } else if (from !== 'search' && from !== 'api' && !allowUnlisted) {
    throw new ScoutError(
      'refusing to download a URL with no provenance: pass --page-url (the page it came from), ' +
        '--from search (for URLs printed by the search command), or --allow-unlisted',
      EXIT.USAGE,
    );
  }

  const maxBytes = positiveInt(values['max-bytes'], DEFAULT_MAX_BYTES);
  const minBytes = positiveInt(values['min-bytes'], DEFAULT_MIN_BYTES);
  const response = await fetchUrl(imageUrl, { ...httpOptions(values), maxBytes });
  const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const sniffed = sniffImage(response.body);
  if (!sniffed) {
    throw new ScoutError(
      `downloaded ${response.body.length} bytes but magic bytes are not JPEG/PNG/GIF/WEBP ` +
        `(content-type: ${contentType || 'unknown'})`,
      EXIT.VERIFY,
    );
  }
  if (response.body.length < minBytes) {
    throw new ScoutError(
      `downloaded file is only ${response.body.length} bytes (minimum ${minBytes})`,
      EXIT.VERIFY,
    );
  }
  if (contentType !== '' && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
    throw new ScoutError(`unexpected content-type ${contentType} for an image download`, EXIT.VERIFY);
  }

  const outPath = resolvePath(values.out ?? defaultOutputPath(sniffed.mime, imageUrl));
  await mkdir(dirname(outPath), { recursive: true });
  const temporary = join(dirname(outPath), `.${basename(outPath)}.${process.pid}.part`);
  await writeFile(temporary, response.body);
  await rename(temporary, outPath).catch(async (error) => {
    await rm(temporary, { force: true });
    throw error;
  });

  const bytes = response.body.length;
  const result = {
    action: 'download',
    imageUrl,
    pageUrl: pageUrl ?? null,
    out: outPath,
    bytes,
    format: sniffed.format,
    mime: sniffed.mime,
    width: sniffed.width,
    height: sniffed.height,
    license: values.license ?? null,
    message: `VERIFY_OK: ${sniffed.format} ${sniffed.width ?? '?'}x${sniffed.height ?? '?'} ${bytes} bytes`,
  };

  if (!values['no-sidecar']) {
    const sidecar = `${outPath}.json`;
    const record = {
      provider: 'image-scout',
      version: VERSION,
      savedAt: new Date().toISOString(),
      imageUrl,
      pageUrl: pageUrl ?? null,
      file: basename(outPath),
      bytes,
      format: sniffed.format,
      width: sniffed.width,
      height: sniffed.height,
      license: values.license ?? null,
    };
    await writeFile(sidecar, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    result.sidecar = sidecar;
  }

  if (values.json) return result;
  const lines = [result.message, `SAVED: ${outPath}`];
  if (pageUrl) lines.push(`SOURCE: ${pageUrl}`);
  if (!sniffed.width || !sniffed.height) lines.push('WARN: dimensions could not be read from the header');
  if (result.sidecar) lines.push(`META: ${result.sidecar}`);
  return { ...result, lines };
}

function defaultOutputPath(mime, imageUrl) {
  const parsed = new URL(imageUrl);
  const name = basename(parsed.pathname) || 'image';
  const stem = name.replace(/\.[^.]+$/, '') || 'image';
  return join('output', 'reference', `${stem}${MIME_EXT[mime] ?? '.jpg'}`);
}

async function cmdVerify(values) {
  const file = requireOption(values, 'file');
  const minBytes = positiveInt(values['min-bytes'], DEFAULT_MIN_BYTES);
  const result = await verifyFile(resolvePath(file), { minBytes });
  if (!result.ok) {
    throw new ScoutError(`VERIFY_FAILED: ${result.reason}`, result.exitCode ?? EXIT.VERIFY, { file });
  }
  const message = `VERIFY_OK: ${result.format} ${result.width ?? '?'}x${result.height ?? '?'} ${result.bytes} bytes`;
  if (values.json) return { action: 'verify', file: resolvePath(file), ...result, message };
  return {
    action: 'verify',
    file: resolvePath(file),
    ...result,
    message,
    lines: [message, `FILE: ${resolvePath(file)}`],
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function httpOptions(values) {
  return {
    timeoutMs: positiveInt(values.timeout, DEFAULT_TIMEOUT_MS),
    proxy: resolveProxy(values.proxy),
    maxBytes: positiveInt(values['max-bytes'], DEFAULT_MAX_BYTES),
    allowPrivateHosts: Boolean(values['allow-private-hosts']),
    headers: values['user-agent'] ? { 'User-Agent': values['user-agent'] } : {},
  };
}

const HELP = `image-scout ${VERSION} - find real photos, download one, verify it.

USAGE
  image-scout search   --query <text> [--source wikimedia|openverse|all] [--limit 20]
  image-scout list     --page-url <url> [--html-file <path>] [--limit 40]
  image-scout download --image-url <url> (--page-url <url> | --from search | --allow-unlisted)
                       --out <path> [--license <text>]
  image-scout verify   --file <path>

COMMON OPTIONS
  --proxy <url>            HTTP proxy (default: IMAGE_SCOUT_PROXY / HTTPS_PROXY / HTTP_PROXY)
  --timeout <ms>           per-request timeout (default 60000)
  --max-bytes <n>          download cap (default 52428800)
  --min-bytes <n>          reject smaller files, e.g. error pages (default 2000)
  --user-agent <text>      override the User-Agent
  --allow-private-hosts    allow localhost/LAN targets (blocked by default)
  --json                   machine-readable output on stdout
  --help, --version

EXIT CODES
  0 ok   1 usage   2 network   3 verification failed   4 provenance rejected   5 policy

EXAMPLES
  image-scout search --query "red telephone box" --limit 5
  image-scout list --page-url "https://commons.wikimedia.org/w/index.php?search=cat&title=Special:MediaSearch&type=image"
  image-scout download --from search --image-url "https://upload.wikimedia.org/..." --out output/reference/red-phone-01.jpg
`;

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      query: { type: 'string' },
      source: { type: 'string' },
      limit: { type: 'string' },
      'page-url': { type: 'string' },
      'html-file': { type: 'string' },
      'image-url': { type: 'string' },
      out: { type: 'string' },
      file: { type: 'string' },
      license: { type: 'string' },
      from: { type: 'string' },
      proxy: { type: 'string' },
      timeout: { type: 'string' },
      'max-bytes': { type: 'string' },
      'min-bytes': { type: 'string' },
      'user-agent': { type: 'string' },
      'allow-unlisted': { type: 'boolean', default: false },
      'allow-private-hosts': { type: 'boolean', default: false },
      'no-sidecar': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  return { values, positionals };
}

function emit(result, values) {
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } else if (Array.isArray(result.lines)) {
    process.stdout.write(`${result.lines.join('\n')}\n`);
  } else if (typeof result.message === 'string') {
    process.stdout.write(`${result.message}\n`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    process.stderr.write(`FAIL: ${error.message}\n`);
    return EXIT.USAGE;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  }
  if (positionals.length === 0 || positionals[0] === 'help') {
    process.stdout.write(HELP);
    return EXIT.USAGE;
  }

  const command = positionals[0].toLowerCase();
  const commands = { search: cmdSearch, list: cmdList, download: cmdDownload, verify: cmdVerify };
  const handler = commands[command];
  if (!handler) {
    process.stderr.write(`FAIL: unknown command ${JSON.stringify(command)}\n\n${HELP}`);
    return EXIT.USAGE;
  }

  try {
    const result = await handler(values);
    emit(result, values);
    return EXIT.OK;
  } catch (error) {
    const exitCode = error instanceof ScoutError ? error.exitCode : EXIT.USAGE;
    if (values.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: false,
            action: command,
            error: { message: error.message, code: exitCode },
          },
          null,
          2,
        )}\n`,
      );
    }
    process.stderr.write(`FAIL: ${error.message}\n`);
    if (!(error instanceof ScoutError)) {
      process.stderr.write(`${error.stack ?? ''}\n`);
    }
    return exitCode;
  }
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = await main();
}

