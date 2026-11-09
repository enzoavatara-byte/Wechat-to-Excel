/**
 * Test "data banyak": sheet kehabisan baris, tabel template (baris 9–35) penuh, paste ratusan laporan.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Dashboard.gs', 'Ui.gs'];

function setup() {
  const ss = managerSpreadsheet();
  const svc = services(ss);
  const gas = loadGas(FILES, svc);
  return { ss, gas, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)') };
}
const defaultPicks = (p) => p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline }));
const fill = (sh, from, to) => { for (let r = from; r <= to; r++) sh.set('C' + r, 'lama ' + r).set('D' + r, 'lama ' + r); };

/** n laporan berbeda (jam & deskripsi beda), semua jenis Mesin. */
function bigPaste(n) {
  const pad = (x) => String(x).padStart(2, '0');
  return Array.from({ length: n }, (_, i) => {
    const day = 21 + Math.floor(i / 60), m = i % 60;
    return ['①Tingkat saat ini: L1', '②Nama proyek: E245', '③Nama proses: Finishing',
      `④Waktu kejadian:2026.10.${day}/08:${pad(m)}`, `⑤Deskripsi : masalah mesin nomor ${i + 1} pada stasiun lem`,
      '⑥-1Jenis masalah: Mesin', '⑥-2Respond PIC : @iqbal', '⑦-1Status lini produksi: Mesin pulih',
      '⑦-2Status Penanganan: Selesai penanganan', `⑧Waktu penutupan:2026.10.${day}/09:${pad(m)}`, '⑨Durasi dampak: 60 menit'].join('\n');
  }).join('\n\n');
}

test('sheet kehabisan baris: baris ditambah otomatis, data tetap masuk', () => {
  const { gas, geely } = setup();
  geely.maxRows = 22;
  fill(geely, 18, 22);
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.deepEqual(p.sheets, [{ name: 'Geely list (2)', nextRow: 23, error: '' }]);
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)));
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.written.map((w) => [w.row, w.no]), [[23, 15], [24, 16]]);
  assert.ok(geely.getMaxRows() >= 24);
  assert.equal(geely.get('D24'), '上包涂胶机卡住\n(upper pack gluing machine stuck)');
});

test('tabel template penuh (baris 9–35): baris 36+ menyalin format & dropdown H dari baris di atasnya', () => {
  const { gas, geely } = setup();
  fill(geely, 18, 35);
  geely.cell(35, 4).s = { font: 'SimSun', size: 10, h: 'left', wrap: true };
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', [{ id: 3, discipline: 'Machine' }, { id: 4, discipline: 'Machine' }]));
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.written.map((w) => w.row), [36, 37]);
  assert.ok(geely.getRange('H36').getDataValidation(), 'dropdown H36 tersalin');
  assert.ok(geely.getRange('H37').getDataValidation(), 'dropdown H37 tersalin');
  assert.equal(geely.get('H36'), 'Machine');
  assert.deepEqual(geely.styleOf('D36'), { font: 'SimSun', size: 10, h: 'left', wrap: true });
  assert.equal(geely.get('B36'), 15); // nomor urut lanjut dari angka terbesar di B (mock: 1–14)
});

test('paste besar: 120 laporan masuk semua; teks ke penerjemah dipotong kecil', () => {
  const { gas, geely, tr } = setup();
  const text = bigPaste(120);
  const p = plain(gas.previewWeChat(text, 'LImo 7 list'));
  assert.equal(p.records.length, 120);
  assert.equal(p.records.filter((r) => r.include).length, 120);
  const res = plain(gas.importWeChat(text, 'LImo 7 list', defaultPicks(p)));
  assert.deepEqual(res.errors, []);
  assert.equal(res.written.length, 120);
  assert.deepEqual([res.written[0].row, res.written[119].row], [18, 137]);
  assert.equal(geely.get('B137'), 129);
  assert.ok(geely.getRange('H137').getDataValidation());
  assert.ok(tr.calls.every((c) => c.text.length <= 2000), 'potongan terjemahan maks 2.000 karakter');
  assert.ok(tr.calls.length <= 10, 'jumlah panggilan terjemahan tetap kecil: ' + tr.calls.length);
});
