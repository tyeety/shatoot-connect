// Optional live check: electron tests/update-network.cjs [--download]
// Uses an isolated directory, never installs anything or touches the real profile.
const { app } = require('electron');
const path = require('node:path');
const { Updater, electronResponse } = require('../desktop/updater.cjs');
const directory = path.join(__dirname,'../artifacts/update-network');
app.setPath('userData',path.join(directory,'profile'));
setTimeout(() => { console.error('Live updater check timed out.'); app.exit(1); },300000).unref();
app.whenReady().then(async () => {
  const update = new Updater({version:'0.0.0',directory,portable:false,request:electronResponse});
  const result = await update.check(); if (result.state !== 'available') throw new Error(result.error || 'No compatible GitHub release.');
  console.log('Live GitHub release detected:',result.version);
  if (process.argv.includes('--download')) { await update.download(); console.log('Official installer downloaded; exact byte length and SHA256 passed.'); }
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
