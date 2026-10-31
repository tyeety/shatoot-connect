'use strict';
// Keep the browser decoder/encoder separate from application code and load it only when editing media.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/mediabunny');
const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
if (version !== '1.65.0') throw Error('Review the media vendor version before updating the browser bundle.');
const destination = path.join(root, 'desktop/ui/assets');
fs.copyFileSync(path.join(source, 'dist/bundles/mediabunny.min.cjs'), path.join(destination, 'mediabunny.min.js'));
fs.writeFileSync(path.join(destination, 'mediabunny.LICENSE.txt'),
  `Mediabunny ${version}, unmodified browser bundle. Copyright Vanilagy and contributors.\n` +
  `Corresponding source: https://registry.npmjs.org/mediabunny/-/mediabunny-${version}.tgz\n\n` +
  fs.readFileSync(path.join(source, 'LICENSE'), 'utf8'));

const markdown=path.join(root,'node_modules/markdown-it');
if(JSON.parse(fs.readFileSync(path.join(markdown,'package.json'),'utf8')).version!=='15.0.3')throw Error('Review the Markdown vendor version.');
fs.copyFileSync(path.join(markdown,'dist/browser/markdown-it.umd.min.js'),path.join(destination,'markdown-it.min.js'));
fs.copyFileSync(path.join(markdown,'LICENSE'),path.join(destination,'markdown-it.LICENSE.txt'));
