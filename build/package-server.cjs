const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this runtime bundle on Windows x64.');
const nodePath = process.execPath;
const licensePath = path.join(__dirname, 'licenses/Node-LICENSE.txt');
if (!fs.existsSync(licensePath)) throw new Error('Missing Node-LICENSE.txt for the bundled runtime.');
const output = path.join(root, 'release', `ShatootConnect-Server-${version}-win-x64`);
const zip = `${output}.zip`;
const testArtifacts = path.resolve(output, 'validation');
if (path.dirname(testArtifacts) !== path.resolve(output)) throw new Error('Invalid validation cleanup path.');
fs.rmSync(testArtifacts, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'server'), { recursive: true });
fs.mkdirSync(path.join(output, 'shared'), { recursive: true });
fs.mkdirSync(path.join(output, 'node_modules'), { recursive: true });
fs.copyFileSync(nodePath, path.join(output, 'node.exe'));
fs.copyFileSync(licensePath, path.join(output, 'Node-LICENSE.txt'));
fs.copyFileSync(path.join(root, 'desktop/ui/assets/Vazirmatn-OFL.txt'), path.join(output, 'Vazirmatn-OFL.txt'));
for (const name of ['index.cjs', 'standalone.cjs', 'identity-store.cjs', 'managed-turn.cjs', 'collaboration.cjs']) fs.copyFileSync(path.join(root, 'server', name), path.join(output, 'server', name));
const manager = path.join(root, 'server-manager/publish/ShatootConnect.Server.exe');
if (!fs.existsSync(manager)) throw new Error('Build Server Manager before packaging.');
fs.copyFileSync(manager, path.join(output, 'ShatootConnect.Server.exe'));
fs.copyFileSync(path.join(root, 'shared/protocol.cjs'), path.join(output, 'shared/protocol.cjs'));
fs.cpSync(path.join(root, 'node_modules/ws'), path.join(output, 'node_modules/ws'), { recursive: true });
fs.copyFileSync(path.join(root, 'server/server.config.example.json'), path.join(output, 'server.config.json'));
const cmd = fs.readFileSync(path.join(root, 'server/START-SERVER.cmd'), 'utf8').replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(output, 'START-SERVER.cmd'), cmd, 'ascii');
fs.copyFileSync(path.join(root, 'server/README.fa.md'), path.join(output, 'README.fa.md'));
fs.copyFileSync(path.join(root, 'server/README.en.md'), path.join(output, 'README.en.md'));
const runtime = { app: `ShatootConnect Server ${version}`, node: process.version, platform: process.platform, arch: process.arch,
  nodeSha256: crypto.createHash('sha256').update(fs.readFileSync(nodePath)).digest('hex') };
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify(runtime, null, 2));
// Pass paths as process arguments through environment variables, not shell interpolation.
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath $env:SHATOOTCONNECT_BUNDLE_SOURCE -DestinationPath $env:SHATOOTCONNECT_BUNDLE_ZIP -Force'], {
  env: { ...process.env, SHATOOTCONNECT_BUNDLE_SOURCE: output, SHATOOTCONNECT_BUNDLE_ZIP: zip }, stdio: 'inherit'
});
console.log(`Server bundle: ${zip}`);
