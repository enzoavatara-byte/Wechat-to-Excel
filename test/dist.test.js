/**
 * dist/ (file siap-paste) harus selalu sama dengan hasil build dari src/, dan dist/Code.gs
 * harus jalan sendirian (satu file) seperti di Apps Script.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build, DIST } = require('../scripts/build');
const { readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

test('dist/ sinkron dengan src/ (kalau gagal: jalankan npm run build)', () => {
  const out = build();
  for (const f of Object.keys(out)) {
    const file = path.join(DIST, f);
    assert.ok(fs.existsSync(file), 'dist/' + f + ' belum ada');
    assert.equal(fs.readFileSync(file, 'utf8'), out[f], 'dist/' + f + ' tidak sama dengan src/');
  }
});

test('dist/Index.html: Styles & App sudah di-inline, scriptlet mode tetap ada', () => {
  const html = fs.readFileSync(path.join(DIST, 'Index.html'), 'utf8');
  assert.ok(!html.includes('include('));
  assert.ok(html.includes('<style>') && html.includes("google.script.run"));
  assert.deepEqual(html.match(/<\?[\s\S]*?\?>/g), ['<?= mode ?>', '<?!= JSON.stringify(mode) ?>']);
});

test('dist/Code.gs berdiri sendiri: impor fixture berjalan seperti dari src/', () => {
  const ss = managerSpreadsheet();
  const ctx = vm.createContext(Object.assign({ console }, services(ss)));
  vm.runInContext(fs.readFileSync(path.join(DIST, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const text = readFixture('sample.txt');
  const p = JSON.parse(JSON.stringify(ctx.previewWeChat(text, 'LImo 7 list')));
  const picks = p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline }));
  const res = JSON.parse(JSON.stringify(ctx.importWeChat(text, 'LImo 7 list', picks)));
  assert.deepEqual(res.written.map((w) => [w.row, w.start]), [[18, '20:15'], [19, '21:24']]);
  ['onOpen', 'showImportDialog', 'doGet', 'include', 'getInitData'].forEach((fn) => assert.equal(typeof ctx[fn], 'function', fn));
});
