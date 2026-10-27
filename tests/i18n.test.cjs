'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function translations() {
  const context = { window: { dispatchEvent() {} }, document: { documentElement: {}, body: {}, createTreeWalker: () => ({ nextNode: () => false }), querySelectorAll: () => [] }, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, CustomEvent: class {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../desktop/ui/i18n.js'), 'utf8'), context);
  return context.window.i18n;
}

test('host pause badge translates in English and Persian',()=>{
 const i18n=translations(),en='Host active · resumes after 2 s of inactivity',fa='میزبان فعال است؛ کنترل ۲ ثانیه پس از پایان فعالیت آزاد می‌شود';
 assert.equal(i18n.translate(fa),en);i18n.setLanguage('fa');assert.equal(i18n.translate(en),fa);
});

test('connection timeout and dynamic errors translate in both directions without altering unknown details', () => {
  const i18n = translations();
  const timeout = 'Connection timed out. Check host approval and network settings.';
  const faTimeout = 'زمان انتظار اتصال تمام شد؛ تأیید میزبان و تنظیمات شبکه را بررسی کنید.';
  assert.equal(i18n.translate(faTimeout), timeout);
  assert.equal(i18n.translate('تنظیم کیفیت ناموفق بود: شناسه یا رمز اتصال درست نیست.'), 'Quality change failed: Incorrect remote ID or password.');
  assert.equal(i18n.translate('تنظیم کیفیت ناموفق بود: CODE_42'), 'Quality change failed: CODE_42');
  i18n.setLanguage('fa');
  assert.equal(i18n.translate(timeout), faTimeout);
  assert.equal(i18n.translate('Quality change failed: Incorrect remote ID or password.'), 'تنظیم کیفیت ناموفق بود: شناسه یا رمز اتصال درست نیست.');
  assert.equal(i18n.translate('LAN listener unavailable: CODE_42'), 'اتصال محلی در دسترس نیست: CODE_42');
  i18n.setLanguage('en');
  assert.equal(i18n.translate(faTimeout), timeout);
  assert.equal(i18n.translate('Arash / 192.168.1.63'), 'Arash / 192.168.1.63');
});
