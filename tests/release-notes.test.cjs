'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { releaseNotes } = require('../build/release-notes.cjs');
const { version } = require('../package.json');
test('release notes require a unique complete version entry and never include another release', () => {
  const text = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8'), notes = releaseNotes(text);
  assert.ok(notes.length > 40); assert.doesNotMatch(notes, /^## \d+\.\d+\.\d+/m);
  const sample = `## ${version} — 2026-10-21\n\n- This release contains complete notes for a concrete user-visible change.\n\n## 0.0.1 — 2026-01-01\n\n- Previous release notes must not be included.\n`;
  assert.equal(releaseNotes(sample).trim(), '- This release contains complete notes for a concrete user-visible change.');
  assert.throws(() => releaseNotes(text, '99.0.0'), /exactly one/);
  assert.throws(() => releaseNotes(`${text}\n## ${version} — 2026-10-21\nDuplicate entry.`), /exactly one/);
  assert.throws(() => releaseNotes(`## ${version} — 2026-10-21\n\nTODO: finish the changelog entry before publishing this version.`), /complete/);
});
