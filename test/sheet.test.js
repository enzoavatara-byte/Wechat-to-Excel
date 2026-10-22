/**
 * Test penulisan ke sheet (src/Sheet.gs, src/Ui.gs) dengan mock Sheets.
 * Tidak menguji perilaku asli Google (izin, validasi dropdown, UI); itu dicek manual.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Sheet.gs', 'Template.gs', 'Ui.gs'];
const YELLOW = '#FFF2CC';

function setup() {
  const ss = managerSpreadsheet();
  const gas = loadGas(FILES, services(ss));
  return { ss, gas, geely: ss.getSheetByName('Geely list (2)'), limo: ss.getSheetByName('LImo 7 list') };
}

const defaultPicks = (preview) => preview.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline }));

test('getInitData: hanya sheet dengan header baris 8 yang ditawarkan', () => {
  const { gas } = setup();
  const d = plain(gas.getInitData());
  assert.deepEqual(d.sheets, ['LImo 7 list', 'Geely list (2)']);
  assert.equal(d.defaultOther, 'LImo 7 list'); // sheet aktif (Revision_History) bukan sheet issue
  assert.deepEqual(d.projectSheets, [{ project: 'E245', sheet: 'Geely list (2)', ok: true }]);
});

test('preview: change over tidak dicentang, baris tujuan Geely mulai 18', () => {
  const { gas } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.deepEqual(p.records.map((r) => [r.start, r.include]), [
    ['17:20', false], ['18:05', false], ['19:15', false], ['20:15', true], ['21:24', true]
  ]);
  assert.ok(p.records.every((r) => r.sheet === 'Geely list (2)'));
  assert.deepEqual(p.sheets, [{ name: 'Geely list (2)', nextRow: 18, error: '' }]);
  assert.deepEqual(p.records[1].yellow.map((y) => y.col), ['E', 'F', 'H']);
  assert.deepEqual(p.records[1].warnings, [{ col: 'H', msg: '⑥-1 jenis "Change over" belum dipetakan ke Discipline' }]);
});

test('import: menulis ke baris pertama yang C & D kosong, nomor B yang ada tidak diubah', () => {
  const { gas, geely } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)));
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.written.map((w) => [w.sheet, w.row, w.no, w.start]), [
    ['Geely list (2)', 18, 10, '20:15'], ['Geely list (2)', 19, 11, '21:24']
  ]);
  assert.equal(geely.get('B18'), 10);
  assert.equal(geely.get('C18'), 'E245 - Press Modul');
  assert.equal(geely.get('D18'), 'Posisi nozzle tidak masuk pada pallet');
  assert.equal(geely.get('E18'), undefined); // E & F tidak pernah diisi
  assert.equal(geely.get('F18'), undefined);
  assert.equal(geely.get('G18'), (20 * 60 + 23) / 1440);
  assert.equal(geely.fmt('G18'), 'h:mm');
  assert.equal(geely.get('H18'), 'Machine');
  assert.equal(geely.get('I18'), 'muhamad gilang');
  assert.equal(geely.get('J18'), 46315);
  assert.equal(geely.fmt('J18'), 'yyyy/mm/dd');
  assert.equal(geely.get('K18'), 'Level: L1 | Mulai: 20:15 | Durasi: 8 menit | Jenis: Mesin | Lini: Mesin pulih | Penanganan: Selesai penanganan');
  assert.equal(geely.bg('E18'), YELLOW);
  assert.equal(geely.bg('F18'), YELLOW);
  for (const c of ['B', 'C', 'D', 'G', 'H', 'I', 'J', 'K']) assert.equal(geely.bg(c + '18'), undefined, c);
  assert.equal(geely.get('C17'), 'Mesin lama 9'); // baris lama tidak tersentuh
});

test('import ulang teks yang sama: ditandai duplikat dan tidak dicentang', () => {
  const { gas } = setup();
  const p1 = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p1));
  const p2 = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.deepEqual(p2.records.filter((r) => r.duplicateOf).map((r) => [r.start, r.duplicateOf.row]), [['20:15', 18], ['21:24', 19]]);
  assert.equal(p2.records.filter((r) => r.include).length, 0);
  assert.equal(p2.sheets[0].nextRow, 20);
});

test('change over dicentang + Discipline dipilih manual; urutan tulis tetap urut jam', () => {
  const { gas, geely } = setup();
  const picks = [{ id: 4, discipline: 'Machine' }, { id: 1, discipline: 'Operation' }, { id: 0, discipline: '' }];
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', picks));
  assert.deepEqual(res.written.map((w) => [w.row, w.start]), [[18, '17:20'], [19, '18:05'], [20, '21:24']]);
  assert.equal(geely.get('H18'), '');
  assert.equal(geely.bg('H18'), YELLOW);
  assert.match(geely.get('K18'), /⚠ ⑥-1 jenis "Change over" belum dipetakan ke Discipline/);
  assert.equal(geely.get('H19'), 'Operation');
  assert.equal(geely.bg('H19'), undefined);
  assert.match(geely.get('K19'), /Discipline dipilih manual/);
});

test('nomor urut dilanjutkan saat kolom B kosong', () => {
  const { gas, geely } = setup();
  for (let r = 18; r <= 22; r++) geely.set('C' + r, 'isi ' + r).set('D' + r, 'isi ' + r);
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)));
  assert.deepEqual(res.written.map((w) => [w.row, w.no]), [[23, 15], [24, 16]]);
  assert.equal(geely.get('B23'), 15);
  assert.equal(geely.get('B24'), 16);
});

test('proyek lain masuk sheet pilihan; baris dengan J terisi tapi C & D kosong dianggap kosong', () => {
  const { gas, limo } = setup();
  const text = SAMPLE.split('\n\n')[0].replace('Nama proyek: E245', 'Nama proyek: Limo 7').replace('Change over', 'Mesin');
  const res = plain(gas.importWeChat(text, 'LImo 7 list', [{ id: 0 }]));
  assert.deepEqual(res.written.map((w) => [w.sheet, w.row, w.no]), [['LImo 7 list', 15, 7]]);
  assert.equal(limo.get('C15'), 'Limo 7 - Finishing');
  assert.equal(limo.get('J15'), 46315);
});

test('pengaman: tidak pernah menulis ke sheet tanpa header issue', () => {
  const { gas, ss } = setup();
  assert.throws(() => gas.previewWeChat(SAMPLE, 'Revision_History'), /bukan sheet issue/);
  assert.throws(() => gas.importWeChat(SAMPLE, 'Revision_History', [{ id: 3 }]), /bukan sheet issue/);
  assert.throws(() => gas.importWeChat(SAMPLE, 'Tidak Ada', [{ id: 3 }]), /tidak ditemukan/);
  assert.equal(ss.getSheetByName('Revision_History').writes, 0);
});

test('sheet tujuan proyek hilang: laporan ditolak dengan pesan jelas, sisanya tetap ditulis', () => {
  const { gas, ss } = setup();
  ss.getSheetByName('Geely list (2)').name = 'Geely list';
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.ok(p.records.every((r) => !r.include && /tidak ditemukan/.test(r.sheetError)));
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', [{ id: 3 }]));
  assert.equal(res.written.length, 0);
  assert.match(res.errors[0], /^20:15 E245 - Press Modul: Sheet "Geely list \(2\)" tidak ditemukan/);
});

test('record tanpa Machine & Deskripsi tidak ditulis walau dicentang', () => {
  const { gas, limo } = setup();
  const res = plain(gas.importWeChat('①Tingkat saat ini: L1\n④Waktu kejadian:2026.10.20/18:05', 'LImo 7 list', [{ id: 0 }]));
  assert.equal(res.written.length, 0);
  assert.match(res.errors[0], /Machine & Deskripsi kosong/);
  assert.equal(limo.writes, 0);
});

test('teks yang bisa dibaca Sheets sebagai rumus/angka dipaksa jadi teks', () => {
  const { gas, limo } = setup();
  const text = '②Nama proyek: L7\n③Nama proses: Assy\n④Waktu kejadian:2026.10.20/18:05\n' +
    '⑤Deskripsi :\n- lem habis\n- nozzle buntu\n⑥-2Respond PIC : =HYPERLINK("x")\n⑧Waktu penutupan:2026.10.20/18:20';
  const p = plain(gas.previewWeChat(text, 'LImo 7 list'));
  const res = plain(gas.importWeChat(text, 'LImo 7 list', defaultPicks(p)));
  const row = res.written[0].row;
  assert.equal(limo.get('C' + row), 'L7 - Assy');
  assert.equal(limo.get('D' + row), "'- lem habis\n- nozzle buntu");
  assert.equal(limo.get('I' + row), '\'=HYPERLINK("x")');
  // Duplikat tetap terdeteksi (apostrof tidak ikut terbaca).
  const again = plain(gas.previewWeChat(text, 'LImo 7 list'));
  assert.deepEqual(again.records[0].duplicateOf, { where: 'sheet', sheet: 'LImo 7 list', row });
});

test('field rusak -> sel kosong + kuning di sheet', () => {
  const { gas, limo } = setup();
  const text = '②Nama proyek: L7\n③Nama proses: Assy\n④Waktu kejadian: 20/10/2026 18:05\n⑤Deskripsi : baut longgar\n⑥-1Jenis masalah: Material';
  const res = plain(gas.importWeChat(text, 'LImo 7 list', [{ id: 0 }]));
  const row = res.written[0].row;
  for (const c of ['E', 'F', 'G', 'H', 'I', 'J']) assert.equal(limo.bg(c + row), YELLOW, c);
  for (const c of ['C', 'D']) assert.equal(limo.bg(c + row), undefined, c);
  assert.equal(limo.get('J' + row), '');
  assert.match(limo.get('K' + row), /⚠ ④ Waktu kejadian tanggal tidak terbaca: "20\/10\/2026 18:05"/);
});

test('setup: set timezone, cek sheet/proyek/dropdown, tidak menulis data', () => {
  const { gas, ss } = setup();
  const out = gas.setup();
  assert.equal(ss.getSpreadsheetTimeZone(), 'Asia/Shanghai');
  assert.equal(out.split('\n')[0], 'Setup OK. Reload spreadsheet, lalu pakai menu WeChat Import.');
  assert.match(out, /✓ Timezone spreadsheet diubah: Asia\/Jakarta → Asia\/Shanghai/);
  assert.match(out, /✓ Sheet issue \(header baris 8\): LImo 7 list, Geely list \(2\)/);
  assert.match(out, /✓ "Geely list \(2\)": baris berikutnya 18, dropdown H cocok/);
  assert.ok(ss.getSheets().every((sh) => sh.writes === 0));
  assert.match(gas.setup(), /✓ Timezone spreadsheet: Asia\/Shanghai/); // aman diulang
});

test('setup: nama sheet berubah & dropdown beda -> dilaporkan sebagai masalah', () => {
  const { gas, ss, geely, limo } = setup();
  geely.name = 'Geely list';
  limo.set('I5', 'MES System');
  const out = gas.setup();
  assert.equal(out.split('\n')[0], '2 masalah ditemukan.');
  assert.match(out, /✗ Proyek E245 → "Geely list \(2\)" tidak ditemukan/);
  assert.match(out, /✗ "LImo 7 list": dropdown H \[Machine, Operation, Product Item, MES System\] tidak berisi MES/);
  assert.ok(ss.getSheets().every((sh) => sh.writes === 0));
});
