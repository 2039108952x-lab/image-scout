// Guards the shipped skill card: DSH rejects a skill whose frontmatter lacks
// name/description, and silently ignores one whose name fails its slug rule.
// These assertions are cheap and catch a packaging mistake before release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillDir = fileURLToPath(new URL('../skills/image-scout/', import.meta.url));

function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, `${file} must start with a YAML frontmatter block`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

test('skill frontmatter carries a valid DSH name and a description', () => {
  const { fields } = frontmatter(`${skillDir}SKILL.md`);
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(fields.name, 'image-scout');
  assert.ok(fields.description.length >= 40, 'description must be long enough to route on');
  assert.match(fields.description, /[a-zA-Z]/, 'description should contain English keywords');
});

test('skill version matches package.json', () => {
  const { fields } = frontmatter(`${skillDir}SKILL.md`);
  const pkg = JSON.parse(readFileSync(`${repoRoot}package.json`, 'utf8'));
  assert.equal(fields.version, pkg.version);
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
});

test('skill body documents the bundled CLI with a relative path', () => {
  const { body } = frontmatter(`${skillDir}SKILL.md`);
  assert.match(body, /scripts\/image-scout\.mjs/);
  assert.ok(!body.includes('web_fetch'), 'the DSH build must not depend on Reasonix-only tools');
});

test('every top-level file the bundle declares is present', () => {
  for (const file of ['cordis.patch.yml', 'lib/index.js', 'release.json', 'LICENSE']) {
    assert.ok(readFileSync(`${repoRoot}${file}`).length > 0, `${file} must exist and be non-empty`);
  }
});
