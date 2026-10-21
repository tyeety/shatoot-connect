'use strict';
// Called by makensis. Its temporary include is deleted immediately after reading.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function generate(root) {
  const files = fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile()).sort();
  for (const required of ['Shatoot Connect.exe', 'resources/app.asar', 'resources/input/ShatootConnect.Input.exe']) {
    if (!files.some(file => file.replaceAll('\\', '/') === required)) throw new Error(`Missing installer payload: ${required}`);
  }
  let total = 0;
  const checks = files.map(name => {
    const data = fs.readFileSync(path.join(root, name)); total += data.length;
    const hash = crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
    const escaped = name.replaceAll('/', '\\').replaceAll('$', '$$').replaceAll('"', '$\\"');
    return `  \${StdUtils.HashFile} $0 "SHA2-256" "$INSTDIR\\${escaped}"\n  \${If} $0 != "${hash}"\n    StrCpy $SCMessage "$(SCCorrupt) $\\r$\\n${escaped}"\n    StrCpy $SCFailure 14\n    !insertmacro SCLog "Payload verification failed: ${escaped}"\n    Abort\n  \${EndIf}`;
  });
  return `!define SC_PAYLOAD_MB ${Math.ceil(total / 1048576)}\n!macro SCVerifyPayload\n${checks.join('\n')}\n!macroend\n`;
}

if (require.main === module) {
  const [root, output] = process.argv.slice(2);
  if (!root || !output) throw new Error('Expected payload folder and temporary NSIS include path.');
  fs.writeFileSync(output, generate(root));
}
module.exports = { generate };
