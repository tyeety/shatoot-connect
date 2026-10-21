'use strict';
const fs = require('node:fs');
const { version } = require('../package.json');
function releaseNotes(text, expected = version) {
  if (!/^\d+\.\d+\.\d+$/.test(expected)) throw new Error('Release version must use major.minor.patch.');
  const lock = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../package-lock.json'), 'utf8'));
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package-lock.json version does not match package.json.');
  const headings = [...text.matchAll(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$/gm)];
  if (headings.filter(h => h[1] === expected).length !== 1) throw new Error(`CHANGELOG.md must contain exactly one dated entry for ${expected}.`);
  const heading = headings.find(h => h[1] === expected), end = text.indexOf('\n## ', heading.index + heading[0].length);
  const notes = text.slice(heading.index + heading[0].length, end < 0 ? undefined : end).trim();
  if (notes.length < 40 || /TODO|TBD/.test(notes)) throw new Error('Write complete release notes before publishing.');
  return `${notes}\n`;
}
if (require.main === module) {
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
  if (tag && tag !== `v${version}`) throw new Error('Git tag must match package.json version.');
  process.stdout.write(releaseNotes(fs.readFileSync(require('node:path').join(__dirname, '../CHANGELOG.md'), 'utf8')));
}
module.exports = { releaseNotes };
