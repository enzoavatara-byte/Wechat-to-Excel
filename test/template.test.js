/**
 * Test menu "Buat sheet baru" (src/Template.gs) dengan mock Sheets.
 * Yang diuji: isi & struktur sama dengan file manajer, rute kode proyek, dan pengaman.
 * Tampilan sebenarnya (font, warna di layar) tetap harus dicek mata di Google Sheets.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { MockSheet, MockSpreadsheet, managerSpreadsheet, services } = require('./mock-sheets');

const FILES = ['Config.gs', 'Parser.gs', 'Sheet.gs', 'Template.gs', 'Ui.gs'];
const SAMPLE = readFixture('sample.txt');

function load(ss) {
  return loadGas(FILES, services(ss));
}

function l7Report(start, end) {
  return SAMPLE.split('\n\n')[0]
    .replace('Nama proyek: E245', 'Nama proyek: L-7')
    .replace('Change over', 'Mesin')
    .replace('2026.10.20/18:05', '2026.10.20/' + start)
    .replace('2026.10.20/ 18:23', '2026.10.20/' + (end || '18:23'))
    .replace('18 menit', '');
}

test('struktur sama dengan sheet manajer (LImo 7 list)', () => {
  const ss = managerSpreadsheet();
  const gas = load(ss);
  const res = plain(gas.createIssueSheet({ sheetName: 'L7 list', projectName: 'Limo 7', projectCode: 'L7' }));
  assert.deepEqual(res, { sheet: 'L7 list', projectName: 'Limo 7', code: 'L7', createdRevision: false, dataRows: '9–35' });
  const sh = ss.getSheetByName('L7 list');
  assert.equal(ss.getSheets().at(-1), sh); // ditaruh paling akhir

  const row = (r, from, to) => Array.from({ length: to - from + 1 }, (_, i) => sh.cell(r, from + i).v);
  assert.deepEqual(row(8, 2, 11), ['No.序号', 'Machine', 'Issue Description \n问题描述', 'Root Cause\n原因分析',
    'Solution\n解决方案\n', 'End Time\n解决时间', 'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes']);
  assert.deepEqual([1, 2, 3, 4, 5].map((r) => sh.cell(r, 1).v), ['R', 'R', 'Y', 'G', 'N/A']);
  assert.equal(sh.get('G1'), 'Status Overview');
  assert.equal(sh.get('B2'), ' NAME:');
  assert.equal(sh.get('B3'), 'PROJECT NAME ATPU');
  assert.equal(sh.get('B4'), 'Limo 7');
  assert.deepEqual([2, 3, 4, 5].map((r) => row(r, 7, 9)), [
    ['Machine', '=COUNTIF(H9:H679,"Machine")', 'Machine'],
    ['Operation', '=COUNTIF(H9:H680,"Operation")', 'Operation'],
    ['Product Item', '=COUNTIF(H9:H681,"Product Item")', 'Product Item'],
    ['MES', '=COUNTIF(H9:H681,"MES")', 'MES']
  ]);
  assert.equal(sh.get('D5'), 'Total tasks:');
  assert.equal(sh.get('F5'), '=COUNT(B9:B204)-3');
  assert.equal(sh.fmt('F5'), '0');
  assert.equal(sh.get('B6'), '="ASSEMBLY & UPFIT PALLET PRE-ACCEPTANCE CHECKLIST - REV "&MAX(Revision_History!B5:B30)');
  assert.deepEqual(sh.merges, ['B6:G6']);
  assert.deepEqual(Array.from({ length: 27 }, (_, i) => sh.cell(9 + i, 2).v),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].concat(new Array(13).fill(undefined)));
  assert.equal(sh.getLastRow(), 22);

  assert.deepEqual(sh.props, { hiddenGridlines: true, tabColor: '#4F6228', frozenRows: 8 });
  assert.deepEqual(sh.colWidths, { 1: 19, 2: 64, 3: 113, 4: 179, 5: 165, 6: 165, 7: 116, 8: 99, 9: 81, 10: 97, 11: 172 });
  assert.deepEqual(sh.rowHeights, { 1: 19, 2: 19, 3: 28, 4: 30, 5: 24, 6: 19, 7: 19, 8: 38 });
  assert.equal(sh.bg('B8'), '#00B050');
  assert.equal(sh.bg('K8'), '#00B050');
  assert.equal(sh.bg('B6'), '#7F7F7F');
  assert.deepEqual(['G2', 'G3', 'G4', 'G5'].map((a) => [sh.bg(a), sh.styleOf(a).color]),
    [['#FF0000', '#FFFFFF'], ['#FFFF00', '#000000'], ['#92D050', '#FFFFFF'], ['#00B0F0', '#000000']]);
  assert.deepEqual(sh.styleOf('A1'), { font: 'Arial', size: 10, color: '#FFFFFF', h: 'center' });
  assert.deepEqual(sh.styleOf('B4'), { font: 'SimSun', size: 16, weight: 'bold' });
  assert.equal(sh.styleOf('C8').font, 'SimSun');
  assert.equal(sh.styleOf('D8').font, 'Arial');
  assert.deepEqual(sh.styleOf('D20'), { font: 'SimSun', size: 10, v: 'middle', h: 'left', wrap: true });
  assert.equal(sh.fmt('G35'), 'h:mm');
  assert.ok(sh.borders.some(([a, s]) => a === 'B9:K35' && s.every((x) => x === true)));

  // Dropdown H9:H35 dari I2:I5 sheet itu sendiri; conditional format sisa template.
  assert.deepEqual(Array.from(gas.dropdownValues_(sh)), ['Machine', 'Operation', 'Product Item', 'MES']);
  assert.equal(sh.getRange('H35').getDataValidation().allowInvalid, false);
  assert.equal(sh.getRange('H36').getDataValidation(), null);
  assert.deepEqual(Array.from(sh.cfRules, (r) => [r.text, r.bg, r.ranges[0]]), [
    ['N/A', '#00B0F0', 'H9:H35'], ['G', '#92D050', 'H9:H35'], ['Y', '#FFFF00', 'H9:H35'], ['R', '#FF0000', 'H9:H35']
  ]);
  assert.ok(gas.isIssueSheet_(sh));
});

test('Revision_History dibuat bila belum ada, hanya header (riwayat manajer tidak disalin)', () => {
  const ss = new MockSpreadsheet('Baru', [new MockSheet('Sheet1', 1)], 0);
  const gas = load(ss);
  const res = plain(gas.createIssueSheet({ sheetName: 'E245 list' }));
  assert.equal(res.createdRevision, true);
  assert.equal(res.projectName, 'E245 list'); // B4 default = nama sheet
  assert.deepEqual(ss.getSheets().map((s) => s.name), ['Revision_History', 'Sheet1', 'E245 list']);
  const rev = ss.getSheetByName('Revision_History');
  assert.deepEqual([2, 3, 4, 5].map((c) => rev.cell(4, c).v), ['Revision No.', 'Date', 'Revised By', 'Revision Comments']);
  assert.equal(rev.get('B5'), undefined);
  assert.equal(rev.get('D5'), undefined);
  // Sheet kedua tidak membuat Revision_History lagi.
  assert.equal(gas.createIssueSheet({ sheetName: 'Lain' }).createdRevision, false);
});

test('kode proyek: laporan ②Nama proyek: L-7 otomatis masuk sheet baru, mulai baris 9 nomor 1', () => {
  const ss = managerSpreadsheet();
  const gas = load(ss);
  gas.createIssueSheet({ sheetName: 'L7 list', projectName: 'Limo 7', projectCode: 'l 7' });
  const init = plain(gas.getInitData());
  assert.deepEqual(init.projectSheets, [
    { project: 'L7', sheet: 'L7 list', ok: true },
    { project: 'E245', sheet: 'Geely list (2)', ok: true }
  ]);
  assert.ok(init.sheets.includes('L7 list'));

  const text = l7Report('18:05', '18:23') + '\n\n' + l7Report('19:00', '19:10');
  const p = plain(gas.previewWeChat(text, 'LImo 7 list'));
  assert.deepEqual(p.records.map((r) => [r.sheet, r.include]), [['L7 list', true], ['L7 list', true]]);
  assert.deepEqual(p.sheets, [{ name: 'L7 list', nextRow: 9, error: '' }]);
  const res = plain(gas.importWeChat(text, 'LImo 7 list', p.records.map((r) => ({ id: r.id }))));
  assert.deepEqual(res.written.map((w) => [w.sheet, w.row, w.no]), [['L7 list', 9, 1], ['L7 list', 10, 2]]);
  const sh = ss.getSheetByName('L7 list');
  assert.equal(sh.get('C9'), 'L-7 - Finishing');
  assert.equal(sh.get('H9'), 'Machine');
});

test('rute tetap jalan setelah sheet di-rename; hilang setelah sheet dihapus', () => {
  const ss = managerSpreadsheet();
  const gas = load(ss);
  gas.createIssueSheet({ sheetName: 'L7 list', projectCode: 'L7' });
  ss.getSheetByName('L7 list').name = 'Limo 7 (Okt)';
  assert.equal(plain(gas.previewWeChat(l7Report('18:05'), 'LImo 7 list')).records[0].sheet, 'Limo 7 (Okt)');
  ss.deleteSheet(ss.getSheetByName('Limo 7 (Okt)'));
  assert.equal(plain(gas.previewWeChat(l7Report('18:05'), 'LImo 7 list')).records[0].sheet, 'LImo 7 list');
  // Kode bebas lagi, boleh dipakai sheet baru.
  assert.equal(gas.createIssueSheet({ sheetName: 'L7 baru', projectCode: 'L7' }).code, 'L7');
});

test('pengaman: nama kosong/sudah ada, kode sudah dipakai -> ditolak tanpa membuat apa pun', () => {
  const ss = managerSpreadsheet();
  const gas = load(ss);
  const before = ss.getSheets().length;
  assert.throws(() => gas.createIssueSheet({ sheetName: '  ' }), /Nama sheet wajib diisi/);
  assert.throws(() => gas.createIssueSheet({ sheetName: 'Geely list (2)' }), /sudah ada/);
  assert.throws(() => gas.createIssueSheet({ sheetName: 'X', projectCode: 'e-245' }), /Kode proyek E245 sudah dipakai sheet "Geely list \(2\)"/);
  gas.createIssueSheet({ sheetName: 'L7 list', projectCode: 'L7' });
  assert.throws(() => gas.createIssueSheet({ sheetName: 'L7 lagi', projectCode: 'L7' }), /Kode proyek L7 sudah dipakai sheet "L7 list"/);
  assert.equal(ss.getSheets().length, before + 1);
});

test('spreadsheet baru: sheet E245 dari menu menggantikan "Geely list (2)" yang tidak ada', () => {
  const ss = new MockSpreadsheet('Baru', [new MockSheet('Sheet1', 1)], 0);
  const gas = load(ss);
  gas.createIssueSheet({ sheetName: 'L7 list', projectCode: 'L7' });
  let out = gas.setup();
  assert.equal(out.split('\n')[0], '1 masalah ditemukan.');
  assert.match(out, /✗ Proyek E245 → "Geely list \(2\)" tidak ditemukan .*Buat sheet baru" dengan kode E245/);

  assert.equal(gas.createIssueSheet({ sheetName: 'E245 list', projectCode: 'E245' }).code, 'E245');
  out = gas.setup();
  assert.equal(out.split('\n')[0], 'Setup OK. Reload spreadsheet, lalu pakai menu WeChat Import.');
  assert.match(out, /✓ Proyek L7 → "L7 list"/);
  assert.match(out, /✓ Proyek E245 → "E245 list"/);
  assert.match(out, /✓ "E245 list": baris berikutnya 9, dropdown H cocok/);
  const p = plain(gas.previewWeChat(SAMPLE, 'L7 list'));
  assert.ok(p.records.every((r) => r.sheet === 'E245 list'));
});
