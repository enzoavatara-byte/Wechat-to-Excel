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
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Ui.gs'];
const OFF = { translate: false };

function setup() {
  const ss = managerSpreadsheet();
  const svc = services(ss);
  const gas = loadGas(FILES, svc);
  return { ss, gas, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)'), limo: ss.getSheetByName('LImo 7 list') };
}

// Tidak ada sel yang diwarnai: latar C:K baris yang ditulis direset ke polos (null).
function assertNoColor(sh, row) {
  for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
    assert.ok(sh.bg(c + row) === undefined || sh.bg(c + row) === null, c + row + ' berwarna ' + sh.bg(c + row));
  }
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
  assert.deepEqual(p.records[1].empty.map((y) => y.col), ['E', 'F', 'H']);
  assert.deepEqual(p.records[1].warnings, [
    { col: 'H', msg: '⑥-1 jenis "Change over" belum dipetakan ke Discipline' },
    { col: '', msg: '③ "Finishing" diterjemahkan mesin: 精加工 / Finishing. Kalau sudah benar, tambahkan ke TERMS di Config supaya konsisten.' }
  ]);
});

test('preview: C, D, K jadi 中文 + (English) seperti sheet manajer; istilah TERMS tidak lewat mesin', () => {
  const { gas, tr } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.translated, true);
  assert.equal(p.translateError, '');
  const r = p.records[1]; // 18:05, Change over
  assert.equal(r.cells.C, 'E245精加工\n(E245 Finishing)');
  assert.equal(r.cells.D, 'B盒上部模组换胶\n(glue replacement for box B upper module)'); // 模块 -> 模组 (ZH_FIXES)
  assert.equal(r.cells.K, '等级：L1；开始：18:05；影响时长：18分钟；类型：换型；产线状态：设备已恢复；处理状态：处理完成\n' +
    '(Level: L1; Start: 18:05; Downtime: 18 min; Type: Changeover; Line status: Machine recovered; Handling: Handling completed)');
  assert.equal(p.records[0].cells.C, 'E245预装\n(E245 Pre-assembly)'); // Preassy dari TERMS
  assert.ok(!p.records[0].warnings.some((w) => w.msg.includes('diterjemahkan mesin')));
  // Semua teks sekaligus: satu panggilan Indonesia->Inggris, satu Inggris->Mandarin.
  assert.deepEqual(tr.calls.map((c) => c.from + '>' + c.to), ['id>en', 'en>zh-CN']);
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
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)');
  assert.equal(geely.get('D18'), '喷嘴位置未进入托盘\n(Nozzle position does not enter the pallet)');
  assert.equal(geely.note('C18'), 'Asli (ID): E245 - Press Modul');
  assert.equal(geely.note('D18'), 'Asli (ID): Posisi nozzle tidak masuk pada pallet');
  assert.equal(geely.get('E18'), undefined); // E & F tidak pernah diisi
  assert.equal(geely.get('F18'), undefined);
  assert.equal(geely.get('G18'), (20 * 60 + 23) / 1440);
  assert.equal(geely.fmt('G18'), 'h:mm');
  assert.equal(geely.get('H18'), 'Machine');
  assert.equal(geely.get('I18'), 'muhamad gilang');
  assert.equal(geely.get('J18'), 46315);
  assert.equal(geely.fmt('J18'), 'yyyy/mm/dd');
  assert.equal(geely.get('K18'), '等级：L1；开始：20:15；影响时长：8分钟；类型：设备；产线状态：设备已恢复；处理状态：处理完成\n' +
    '(Level: L1; Start: 20:15; Downtime: 8 min; Type: Machine; Line status: Machine recovered; Handling: Handling completed)');
  assert.equal(geely.note('K18'), 'Asli (ID): Level: L1 | Jenis: Mesin | Lini: Mesin pulih | Penanganan: Selesai penanganan\n' +
    '⚠ ③ "Press Modul" diterjemahkan mesin: 模组压装 / Module Press. Kalau sudah benar, tambahkan ke TERMS di Config supaya konsisten.');
  assertNoColor(geely, 18);
  assertNoColor(geely, 19);
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
  assertNoColor(geely, 18);
  assert.match(geely.note('K18'), /⚠ ⑥-1 jenis "Change over" belum dipetakan ke Discipline/);
  assert.equal(geely.get('H19'), 'Operation');
  assert.match(geely.note('K19'), /Discipline dipilih manual/);
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
  assert.equal(limo.get('C15'), 'Limo 7精加工\n(Limo 7 Finishing)');
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
  const p = plain(gas.previewWeChat(text, 'LImo 7 list', OFF));
  const res = plain(gas.importWeChat(text, 'LImo 7 list', defaultPicks(p), OFF));
  const row = res.written[0].row;
  assert.equal(limo.get('C' + row), 'L7 - Assy');
  assert.equal(limo.get('D' + row), "'- lem habis\n- nozzle buntu");
  assert.equal(limo.get('I' + row), '\'=HYPERLINK("x")');
  // Duplikat tetap terdeteksi (apostrof tidak ikut terbaca).
  const again = plain(gas.previewWeChat(text, 'LImo 7 list', OFF));
  assert.deepEqual(again.records[0].duplicateOf, { where: 'sheet', sheet: 'LImo 7 list', row });
});

test('field rusak -> sel kosong tanpa warna, peringatan di catatan sel K', () => {
  const { gas, limo } = setup();
  limo.getRange('E15:K15').setBackground('#FFF2CC'); // sisa warna kuning dari versi lama
  const text = '②Nama proyek: L7\n③Nama proses: Assy\n④Waktu kejadian: 20/10/2026 18:05\n⑤Deskripsi : baut longgar\n⑥-1Jenis masalah: Material';
  const res = plain(gas.importWeChat(text, 'LImo 7 list', [{ id: 0 }]));
  const row = res.written[0].row;
  assert.equal(row, 15);
  assertNoColor(limo, row);
  assert.deepEqual(res.written[0].empty.map((e) => e.col), ['E', 'F', 'G', 'H', 'I', 'J']);
  assert.equal(limo.get('J' + row), '');
  assert.equal(limo.get('G' + row), '');
  assert.match(limo.note('K' + row), /⚠ ④ Waktu kejadian tanggal tidak terbaca: "20\/10\/2026 18:05"/);
});

test('tanpa terjemahan (translate: false): Bahasa Indonesia, peringatan di K, tanpa catatan sel', () => {
  const { gas, geely, tr } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list', OFF));
  assert.equal(p.translated, false);
  assert.equal(p.records[3].cells.C, 'E245 - Press Modul');
  gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p), OFF);
  assert.equal(geely.get('C18'), 'E245 - Press Modul');
  assert.equal(geely.get('K18'), 'Level: L1 | Mulai: 20:15 | Durasi: 8 menit | Jenis: Mesin | Lini: Mesin pulih | Penanganan: Selesai penanganan');
  assert.equal(geely.note('C18'), '');
  assertNoColor(geely, 18);
  assert.equal(tr.calls.length, 0);
});

test('terjemahan gagal total (kuota habis + rumus gagal): pratinjau tetap tampil + pesan, impor tidak menulis', () => {
  const { gas, geely, tr, ss } = setup();
  tr.fail = true;
  ss.formulaFail = true;
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.translated, false);
  assert.match(p.translateError, /^Terjemahan gagal: Kuota harian Google Translate untuk akun ini habis \(\d+ panggilan hari ini\), dan cadangan rumus GOOGLETRANSLATE juga gagal: hasil rumus #VALUE!/);
  assert.equal(p.records[3].cells.C, 'E245 - Press Modul');
  const writes = geely.writes;
  assert.throws(() => gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)), /Terjemahan gagal, tidak ada yang ditulis/);
  assert.equal(geely.writes, writes);
  assert.equal(geely.get('C18'), undefined);
});

test('penerjemah menggabung baris -> diulang per baris, pasangan teks tetap benar', () => {
  const { gas, tr } = setup();
  tr.mergeLines = true;
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.records[3].cells.D, '喷嘴位置未进入托盘\n(Nozzle position does not enter the pallet)');
  assert.equal(p.records[4].cells.C, 'E245精加工\n(E245 finishing)');
  assert.ok(tr.calls.length > 2);
});

test('duplikat tetap terdeteksi walau C/D sudah diterjemahkan (pakai teks asli di catatan sel)', () => {
  const { gas, geely } = setup();
  const p1 = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p1));
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)');
  const p2 = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.deepEqual(p2.records.filter((r) => r.duplicateOf).map((r) => r.duplicateOf.row), [18, 19]);
});

test('menu Terjemahkan sel terpilih: teks Indonesia jadi 中文 + (English); rumus & Mandarin dilewati', () => {
  const { gas, geely } = setup();
  geely.set('E18', 'baut longgar').set('F18', '=SUM(1)').set('E19', '已有中文\n(Already)').set('F19', 46310);
  const res = plain(gas.translateRange_(geely.getRange('E18:F19')));
  assert.equal(res.count, 1);
  assert.equal(geely.get('E18'), '中:EN:baut longgar\n(EN:baut longgar)');
  assert.equal(geely.note('E18'), 'Asli (ID): baut longgar');
  assert.equal(geely.get('F18'), '=SUM(1)');
  assert.equal(geely.get('E19'), '已有中文\n(Already)');
  assert.equal(geely.get('F19'), 46310);
  assert.equal(plain(gas.translateRange_(geely.getRange('E19:F19'))).count, 0);
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

test('REGRESI: menu Terjemahkan sel terpilih pada satu baris penuh tidak menyentuh H/I/B/G/J', () => {
  const { gas, geely } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', defaultPicks(p)); // baris 18: H18 = "Machine" (dropdown), I18 = nama
  geely.set('E18', 'baut longgar').set('F18', 'ganti baut baru');
  const before = { H: geely.get('H18'), I: geely.get('I18'), B: geely.get('B18'), G: geely.get('G18'), J: geely.get('J18'), K: geely.get('K18') };
  const res = plain(gas.translateRange_(geely.getRange('B18:K18'))); // dulu: error validasi di H
  assert.equal(res.count, 2);
  assert.equal(geely.get('E18'), '中:EN:baut longgar\n(EN:baut longgar)');
  assert.equal(geely.get('F18'), '中:EN:ganti baut baru\n(EN:ganti baut baru)');
  assert.deepEqual({ H: geely.get('H18'), I: geely.get('I18'), B: geely.get('B18'), G: geely.get('G18'), J: geely.get('J18'), K: geely.get('K18') }, before);
  assert.match(res.message, /2 sel diterjemahkan/);
  assert.match(res.message, /dilewati/);
});

test('menu Terjemahkan: header & area atas (sumber dropdown I2:I5) tidak pernah diterjemahkan', () => {
  const { gas, geely } = setup();
  const res = plain(gas.translateRange_(geely.getRange('A1:K8')));
  assert.equal(res.count, 0);
  assert.deepEqual([2, 3, 4, 5].map((r) => geely.cell(r, 9).v), ['Machine', 'Operation', 'Product Item', 'MES']);
  assert.equal(geely.get('J8'), 'Date');
});

test('menu Terjemahkan: sheet bukan sheet issue ditolak', () => {
  const { gas, ss } = setup();
  const rev = ss.getSheetByName('Revision_History');
  const res = plain(gas.translateRange_(rev.getRange('B2:C4')));
  assert.equal(res.count, 0);
  assert.match(res.message, /Hanya untuk sheet issue/);
  assert.equal(rev.get('B2'), 'Document Revision History');
});

test('menu Terjemahkan: sel ber-dropdown di kolom yang boleh diterjemahkan tetap dilewati', () => {
  const { gas, geely } = setup();
  geely.set('E20', 'Machine');
  const source = geely.getRange('I2:I5');
  geely.validations.set('20,5', { allowInvalid: false, getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [source, true] });
  const res = plain(gas.translateRange_(geely.getRange('E20')));
  assert.equal(res.count, 0);
  assert.equal(geely.get('E20'), 'Machine');
});
