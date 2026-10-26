/**
 * Test penghematan & ketahanan kuota Google Translate (src/Translate.gs).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Ui.gs'];

function setup() {
  const ss = managerSpreadsheet();
  const svc = services(ss);
  const gas = loadGas(FILES, svc);
  return { ss, gas, svc, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)') };
}
const defaultPicks = (p) => p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline }));

test('cache: impor setelah pratinjau tidak memanggil Google Translate lagi', () => {
  const { gas, tr, geely } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(tr.calls.length, 2);
  gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p));
  gas.previewWeChat(SAMPLE, 'LImo 7 list');
  assert.equal(tr.calls.length, 2); // semua dari cache
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)');
});

test('penghitung panggilan harian bertambah & tampil di setup', () => {
  const { gas } = setup();
  gas.previewWeChat(SAMPLE, 'LImo 7 list');
  assert.equal(gas.translateCallsToday_(), 2);
  assert.match(gas.setup(), /Panggilan Google Translate hari ini: \d+/);
});

test('batas per menit: tunggu lalu coba lagi, hasil tetap benar', () => {
  const { gas, tr, svc } = setup();
  tr.failRate = 2;
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.translateError, '');
  assert.equal(p.records[3].cells.C, 'E245模组压装\n(E245 Module Press)');
  assert.deepEqual(svc.Utilities.sleeps, [2000, 4000]);
});

test('batas per menit terus-menerus: menyerah setelah 3 kali coba ulang, pesan jelas', () => {
  const { gas, tr } = setup();
  tr.failRate = 99;
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.match(p.translateError, /too many times in a short time/);
  assert.equal(tr.calls.length, 4);
});

test('kuota harian habis: otomatis pakai rumus GOOGLETRANSLATE, sheet sementara dihapus lagi', () => {
  const { gas, tr, ss, geely } = setup();
  tr.fail = true;
  const before = ss.getSheets().map((s) => s.name);
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.translateError, '');
  assert.equal(p.records[3].cells.C, 'E245模组压装\n(E245 Module Press)');
  assert.ok(ss.formulaCalls.length > 0);
  assert.deepEqual(ss.getSheets().map((s) => s.name), before);
  assert.equal(ss.getActiveSheet().name, before[0]);
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)));
  assert.deepEqual(res.errors, []);
  assert.equal(geely.get('D18'), '喷嘴位置未进入托盘\n(Nozzle position does not enter the pallet)');
});

test('baris digabung penerjemah: diulang SEKALI dalam mode HTML, bukan per baris', () => {
  const { gas, tr } = setup();
  tr.mergeLines = true;
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.records[3].cells.D, '喷嘴位置未进入托盘\n(Nozzle position does not enter the pallet)');
  assert.deepEqual(tr.calls.map((c) => c.from + '>' + c.to + (c.html ? ' html' : '')),
    ['id>en', 'id>en html', 'en>zh-CN', 'en>zh-CN html']);
});
