/**
 * Pelapor dari header pesan WeChat (nama + waktu kirim), K ringkas dengan pelapor, rute kode proyek.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const LIMO = readFixture('limo7.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Dashboard.gs', 'Ui.gs'];
const parser = loadGas(['Config.gs', 'Parser.gs']);

// Laporan kedua dari pengirim lain, ditempel tepat setelah laporan pertama (seperti salinan chat).
const SECOND = '\nAndi Saputra\n2026/11/09  10:12\n' + LIMO.split('\n').slice(2).join('\n')
  .replace('07:30', '09:40').replace('09:05', '10:10').replace('95 menit', '30 menit')
  .replace('conveyor cell online line B stuck', 'sensor pallet error');

test('pelapor = nama pengirim WeChat sebelum laporan; isi laporan tetap terbaca', () => {
  const [r] = parser.parseReports(LIMO);
  assert.equal(r.reporter, 'Raihan Farhan');
  assert.equal(r.project, 'DJ2518 - VFLimo7');
  assert.equal(r.process, 'cell online Line B');
  assert.equal(r.description, 'conveyor cell online line B stuck');
  assert.equal(r.pic, '牧師 imam, Iqbal');
  assert.equal(r.discipline, 'Machine'); // "Masalah Mesin"
  assert.equal(parser.fmtTime_(r.start.time), '7:30');
  assert.equal(r.duration, 95);
  assert.deepEqual(plain(r.warnings), []);
});

test('beberapa pesan: header pesan berikutnya tidak ikut ke ⑨ laporan sebelumnya', () => {
  const recs = parser.parseReports(LIMO + SECOND);
  assert.deepEqual(plain(recs.map((r) => [r.reporter, r.description, r.reportedDuration])), [
    ['Raihan Farhan', 'conveyor cell online line B stuck', 95],
    ['Andi Saputra', 'sensor pallet error', 30]
  ]);
  recs.forEach((r) => assert.deepEqual(plain(r.warnings), []));
});

test('pelapor tidak ditebak: tanpa header, atau baris sebelum laporan bukan pola nama + jam', () => {
  const body = LIMO.split('\n').slice(2).join('\n');
  assert.equal(parser.parseReports(body)[0].reporter, '');
  assert.equal(parser.parseReports('Tolong dicek: mesin macet\n' + body)[0].reporter, '');
  assert.equal(parser.parseReports('2026/11/09 9:05\n' + body)[0].reporter, ''); // jam saja tanpa nama
  assert.equal(parser.parseReports('Raihan Farhan 2026/11/09 9:05\n' + body)[0].reporter, 'Raihan Farhan'); // satu baris
  // Laporan kedua tanpa header: ⑨ laporan pertama tidak dianggap nama pengirim.
  const two = parser.parseReports(LIMO + '\n' + body.replace('07:30', '09:40'));
  assert.deepEqual(plain(two.map((r) => r.reporter)), ['Raihan Farhan', '']);
});

test('K ringkas + pelapor; status ⑦ yang belum selesai tetap ditulis', () => {
  const [r] = parser.parseReports(LIMO);
  const row = parser.buildRow_(r);
  assert.equal(row.notesBase, 'Mulai: 7:30 | Durasi: 95 menit');
  assert.equal(row.values.NOTES, 'Mulai: 7:30 | Durasi: 95 menit | Pelapor: Raihan Farhan');
  assert.ok(row.notes.NOTES.endsWith('| Pelapor: Raihan Farhan'));
  const open = parser.parseReports(LIMO.replace('Machine pulih', 'Mesin masih berhenti').replace('selesai di tangani', 'belum selesai')
    .replace('L1', 'L2'))[0];
  assert.equal(parser.buildRow_(open).values.NOTES,
    'Mulai: 7:30 | Durasi: 95 menit | Level: L2 | Lini: Mesin masih berhenti | Penanganan: belum selesai | Pelapor: Raihan Farhan');
  assert.equal(parser.withReporter_('开始：7:30\n(Start: 7:30)', 'Budi'), '开始：7:30；报告人：Budi\n(Start: 7:30; Reporter: Budi)');
  assert.equal(parser.withReporter_('x', ''), 'x');
});

test('rute: kode proyek cocok dengan salah satu bagian "DJ2518 - VFLimo7"', () => {
  const rec = { project: 'DJ2518 - VFLimo7' };
  assert.equal(parser.targetSheetName_(rec, 'lain', { DJ2518: 'Limo' }), 'Limo');
  assert.equal(parser.targetSheetName_(rec, 'lain', { VFLIMO7: 'Limo' }), 'Limo');
  assert.equal(parser.targetSheetName_(rec, 'lain', { DJ2518VFLIMO7: 'Lengkap', DJ2518: 'Limo' }), 'Lengkap');
  assert.equal(parser.targetSheetName_({ project: 'E245' }, 'lain', { DJ2518: 'Limo' }), 'lain');
});

test('impor: pelapor dari header, bisa diganti di pratinjau; terbaca lagi di Lengkapi, Ringkasan, daftar nama', () => {
  const ss = managerSpreadsheet();
  const gas = loadGas(FILES, services(ss));
  gas.createIssueSheet({ sheetName: 'Limo list (2)', projectName: 'DJ2518 – VFLimo7' }); // seperti file asli
  const p = plain(gas.previewWeChat(LIMO + SECOND, 'LImo 7 list'));
  assert.deepEqual(p.records.map((r) => r.reporter), ['Raihan Farhan', 'Andi Saputra']);
  assert.equal(p.records[0].cells.K, '开始：7:30；影响时长：95分钟\n(Start: 7:30; Downtime: 95 min)'); // tanpa pelapor (ditambah UI)
  const res = plain(gas.importWeChat(LIMO + SECOND, 'LImo 7 list', [{ id: 0 }, { id: 1, reporter: '  Budi   Santoso ' }]));
  assert.deepEqual(res.errors, []);
  const limo = ss.getSheetByName('Limo list (2)');
  const [a, b] = res.written;
  assert.deepEqual([a.sheet, a.row, a.no, b.row, b.no], ['Limo list (2)', 9, 1, 10, 2]); // rute DJ2518 (Config)
  assert.equal(limo.get('K' + a.row), '开始：7:30；影响时长：95分钟；报告人：Raihan Farhan\n(Start: 7:30; Downtime: 95 min; Reporter: Raihan Farhan)');
  assert.equal(limo.get('K' + b.row), '开始：9:40；影响时长：30分钟；报告人：Budi Santoso\n(Start: 9:40; Downtime: 30 min; Reporter: Budi Santoso)');
  assert.ok(limo.note('K' + a.row).includes('| Pelapor: Raihan Farhan'));
  assert.equal(a.reporter, 'Raihan Farhan');
  const row = plain(gas.listIncomplete()).rows.find((r) => r.row === b.row && r.sheet === 'Limo list (2)');
  assert.deepEqual([row.reporter, row.start, row.downtime], ['Budi Santoso', '9:40', 30]);
  const dash = plain(gas.getDashboard()).rows.find((r) => r.row === a.row && r.sheet === 'Limo list (2)');
  assert.equal(dash.reporter, 'Raihan Farhan');
  assert.deepEqual(plain(gas.getInitData()).reporters.map((x) => x.name), ['Budi Santoso', 'Raihan Farhan']);
});

test('Machine dengan nama proyek ber-" - ": proses = bagian terakhir (Lengkapi, edit)', () => {
  const gas = loadGas(FILES, services(managerSpreadsheet()));
  assert.deepEqual(plain(gas.splitMachine_('DJ2518 - VFLimo7 - cell online Line B')), { project: 'DJ2518 - VFLimo7', process: 'cell online Line B' });
  assert.deepEqual(plain(gas.splitMachine_('E245 - Press Modul')), { project: 'E245', process: 'Press Modul' });
});
