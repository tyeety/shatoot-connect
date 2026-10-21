'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { releaseNotes } = require('../build/release-notes.cjs');
const { version } = require('../package.json');
test('release notes require a unique complete version entry and never include another release', () => {
  const text = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8'), notes = releaseNotes(text);
  assert.match(notes, /collaboration-v1/); assert.doesNotMatch(notes, /## 0\.9\.0/);
  assert.throws(() => releaseNotes(text, '99.0.0'), /exactly one/);
  assert.throws(() => releaseNotes(`${text}\n## ${version} — 2026-10-21\nDuplicate entry.`), /exactly one/);
  assert.throws(() => releaseNotes(`## ${version} — 2026-10-21\n\nTODO: finish the changelog entry before publishing this version.`), /complete/);
});
