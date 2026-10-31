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
const markdownBuild=require('esbuild').buildSync({stdin:{contents:"module.exports=require('markdown-it');module.exports.taskLists=require('markdown-it-task-lists');",resolveDir:root},bundle:true,format:'iife',globalName:'markdownit',minify:true,metafile:true,legalComments:'eof',outfile:path.join(destination,'markdown-it.min.js')});
fs.copyFileSync(path.join(markdown,'LICENSE'),path.join(destination,'markdown-it.LICENSE.txt'));

// The visual editor and Markdown mode share one ProseMirror document model.
const editorBuild=require('esbuild').buildSync({metafile:true,entryPoints:[path.join(root,'desktop/ui/message-editor.js')],bundle:true,format:'iife',globalName:'ShatootMarkdownEditor',minify:true,legalComments:'eof',outfile:path.join(destination,'message-editor.min.js')});
const bundledPackages=new Set();
for(const input of [...Object.keys(editorBuild.metafile.inputs),...Object.keys(markdownBuild.metafile.inputs)]){
 if(!input.includes('node_modules'))continue;let directory=path.dirname(path.resolve(root,input));while(directory!==root&&!fs.existsSync(path.join(directory,'package.json')))directory=path.dirname(directory);if(directory!==root)bundledPackages.add(directory);
}
fs.writeFileSync(path.join(destination,'message-editor.LICENSE.txt'),[...bundledPackages].sort().map(directory=>{const info=require(path.join(directory,'package.json')),license=['LICENSE.md','LICENSE','LICENSE.txt','LICENSE-MIT.txt','license'].map(name=>path.join(directory,name)).find(file=>fs.existsSync(file));if(!license)throw Error('Missing bundled dependency license: '+info.name);return info.name+' '+info.version+'\n'+fs.readFileSync(license,'utf8');}).join('\n\n'));
