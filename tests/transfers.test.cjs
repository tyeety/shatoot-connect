const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transfers, safeRelative } = require('../desktop/transfers.cjs');
test('transfers preserve files, folders, hashes and names without overwriting prior receives', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shatoot-transfer-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await fs.mkdir(path.join(source, 'پوشه خالی'), { recursive: true });
  const bytes = crypto.randomBytes(200123); await fs.writeFile(path.join(source, 'فارسی.bin'), bytes); await fs.writeFile(path.join(source, 'empty.txt'), '');
  const send = new Transfers(path.join(root, 'unused')), receive = new Transfers(path.join(root, 'received'));
  for (let repeat = 0; repeat < 2; repeat++) {
    const entries = await send.offer([source]); await receive.begin(entries);
    for (let index = 0; index < entries.length; index++) {
      const file = entries[index]; let offset = 0, hash = crypto.createHash('sha256').digest('hex');
      while (offset < file.size) { const chunk = await send.read({ id: file.id, offset }); await receive.write({ index, offset, bytes: chunk.bytes }); offset += chunk.length; if (chunk.hash) hash = chunk.hash; }
      await receive.endFile({ index, hash });
    }
    const [folder] = await receive.finish(); assert.deepEqual(await fs.readFile(path.join(folder, 'فارسی.bin')), bytes); assert.ok((await fs.stat(path.join(folder, 'پوشه خالی'))).isDirectory());
    assert.equal((await fs.stat(path.join(folder, 'empty.txt'))).size, 0);
  }
  assert.equal((await fs.readdir(path.join(root, 'received'))).length, 2);
});
test('rejects traversal, device paths, forged grants, oversized data, corruption and cleans partial receives', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shatoot-transfer-')); t.after(() => fs.rm(root, { recursive: true, force: true })); const receive = new Transfers(root);
  for (const name of ['../x','C:/x','x/../y','x\\y','x:ads','CON','nul.txt','x.','x/','/root','a//b']) assert.throws(() => safeRelative(name));
  await assert.rejects(receive.read({ id: 'forged', offset: 0 }));
  await assert.rejects(receive.begin([{ name: 'file', size: 11 * 1024 ** 3 }]));
  await assert.rejects(receive.begin([{ name: 'X', size: 1 }, { name: 'x/a', size: 1 }]));
  await receive.begin([{ name: 'file', size: 4 }]);
  await assert.rejects(receive.write({ index: 0, offset: 1, bytes: 'YQ==' }));
  await assert.rejects(receive.write({ index: 0, offset: 0, bytes: Buffer.alloc(32769).toString('base64') }));
  await receive.write({ index: 0, offset: 0, bytes: Buffer.from('abcd').toString('base64') });
  await assert.rejects(receive.endFile({ index: 0, hash: 'wrong' }), /integrity/);
  await receive.reset(); assert.deepEqual(await fs.readdir(root), []);
});
