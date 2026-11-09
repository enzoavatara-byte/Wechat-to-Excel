/**
 * Test tab "Lengkapi" (src/Complete.gs): isi E/F/H dari web app, langsung diterjemahkan.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Dashboard.gs', 'Ui.gs'];

/** Spreadsheet manajer + 2 laporan diimpor (Geely list (2) baris 18 & 19, H = Machine, E/F kosong). */
function setup() {
  const ss = managerSpreadsheet();
  const svc = services(ss);
  const gas = loadGas(FILES, svc);
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline })));
  svc.LanguageApp.calls.length = 0;
  return { ss, gas, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)') };
}

const find = (list, sheet, row) => list.rows.find((r) => r.sheet === sheet && r.row === row);
const expectOf = (r) => ({ machine: r.machine, description: r.description, rootCause: r.rootCause, solution: r.solution, discipline: r.discipline });

test('daftar: baris hasil impor dengan E/F kosong muncul, terbaru dulu, dengan teks asli', () => {
  const { gas } = setup();
  const list = plain(gas.listIncomplete());
  const r = find(list, 'Geely list (2)', 19);
  assert.ok(r);
  assert.equal(list.rows[0].row, 19); // 2026/10/20 terbaru, baris terbesar dulu
  assert.equal(r.no, '11');
  assert.equal(r.machine, 'E245精加工\n(E245 finishing)');
  assert.equal(r.machineOrig, 'E245 - finishing');
  assert.equal(r.descOrig, 'mesin lem upper pack stuck');
  assert.equal(r.end, '21:40');
  assert.equal(r.date, '2026/10/20');
  assert.deepEqual(r.need.map((n) => n.col), ['E', 'F']); // H sudah Machine
  assert.equal(list.total, list.rows.length);
  assert.deepEqual(list.disciplines, ['Machine', 'Operation', 'Product Item', 'MES']);
  // Baris lama manajer: J nomor seri berformat General ("46310") ditampilkan & diurutkan sebagai tanggal.
  const old = find(list, 'Geely list (2)', 17);
  assert.equal(old.date, '2026/10/15');
  assert.equal(old.dateShown, '46310');
  assert.ok(list.rows.indexOf(old) > list.rows.indexOf(r));
});

test('simpan: E/F Bahasa Indonesia langsung jadi 中文 + (English), teks asli di catatan sel', () => {
  const { gas, geely, tr } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  const after = plain(gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: 'baut longgar', solution: 'ganti baut baru' }));
  assert.equal(geely.get('E18'), '中:EN:baut longgar\n(EN:baut longgar)');
  assert.equal(geely.get('F18'), '中:EN:ganti baut baru\n(EN:ganti baut baru)');
  assert.equal(geely.note('E18'), 'Asli (ID): baut longgar');
  assert.equal(geely.note('F18'), 'Asli (ID): ganti baut baru');
  assert.equal(geely.get('H18'), 'Machine');
  assert.deepEqual(after.need, []);
  assert.deepEqual(tr.calls.map((c) => c.from + '>' + c.to), ['id>en', 'en>zh-CN']); // E & F sekaligus
  assert.equal(find(plain(gas.listIncomplete()), 'Geely list (2)', 18), undefined); // sudah lengkap
});

test('simpan: hanya Root Cause dulu, Solution menyusul; Discipline kosong bisa dipilih', () => {
  const { gas, geely } = setup();
  geely.set('H18', '');
  let r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  assert.deepEqual(r.need.map((n) => n.col), ['E', 'F', 'H']);
  r = plain(gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: 'baut longgar', discipline: 'Operation' }));
  assert.equal(geely.get('H18'), 'Operation');
  assert.deepEqual(r.need.map((n) => n.col), ['F']);
  r = plain(gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), solution: 'ganti baut baru' }));
  assert.deepEqual(r.need, []);
  assert.equal(geely.get('E18'), '中:EN:baut longgar\n(EN:baut longgar)');
});

test('E yang diketik manual dalam Bahasa Indonesia (belum diterjemahkan) bisa diterjemahkan dari tab ini', () => {
  const { gas, geely } = setup();
  geely.set('E18', 'baut longgar');
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  assert.deepEqual(r.need.map((n) => n.col), ['E', 'F']);
  gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: r.rootCause });
  assert.equal(geely.get('E18'), '中:EN:baut longgar\n(EN:baut longgar)');
});

test('teks yang sudah berbahasa Mandarin ditulis apa adanya (tanpa terjemahan)', () => {
  const { gas, geely, tr } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: '螺栓松动\n(Loose bolt)' });
  assert.equal(geely.get('E18'), '螺栓松动\n(Loose bolt)');
  assert.equal(geely.note('E18'), '');
  assert.equal(tr.calls.length, 0);
});

test('pengaman: isi Mandarin (mis. dari manajer) tidak pernah ditimpa', () => {
  const { gas, geely } = setup();
  geely.set('E18', '螺栓松动\n(Loose bolt)');
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  assert.deepEqual(r.need.map((n) => n.col), ['F']);
  assert.throws(() => gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: 'baut longgar' }), /E18 sudah berisi teks Mandarin; tidak ditimpa/);
  assert.equal(geely.get('E18'), '螺栓松动\n(Loose bolt)');
});

test('pengaman: baris berubah sejak daftar dimuat -> tidak menulis apa pun', () => {
  const { gas, geely } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  geely.set('D18', 'diubah orang lain');
  const writes = geely.writes;
  assert.throws(() => gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: 'baut longgar' }), /sudah berubah sejak daftar dimuat/);
  assert.equal(geely.writes, writes);
});

test('pengaman: terjemahan gagal -> tidak ada yang ditulis', () => {
  const { gas, geely, tr, ss } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  tr.fail = true;
  ss.formulaFail = true; // cadangan rumus juga gagal
  assert.throws(() => gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: expectOf(r), rootCause: 'baut longgar', solution: 'ganti' }), /Terjemahan gagal, belum ada yang ditulis/);
  assert.equal(geely.get('E18'), undefined);
  assert.equal(geely.get('F18'), undefined);
});

test('pengaman: Discipline di luar dropdown, H yang sudah terisi, isian kosong, baris/sheet tidak valid', () => {
  const { gas } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18);
  const base = { sheet: r.sheet, row: r.row, expect: expectOf(r) };
  assert.throws(() => gas.saveCompletion(Object.assign({}, base, { discipline: 'Mesin' })), /tidak ada di dropdown/);
  assert.throws(() => gas.saveCompletion(Object.assign({}, base, { discipline: 'Operation' })), /H18 sudah terisi/);
  assert.throws(() => gas.saveCompletion(Object.assign({}, base, { rootCause: '   ' })), /Tidak ada yang diisi/);
  assert.throws(() => gas.saveCompletion(Object.assign({}, base, { row: 8, rootCause: 'x' })), /Nomor baris tidak valid/);
  assert.throws(() => gas.saveCompletion(Object.assign({}, base, { sheet: 'Revision_History', rootCause: 'x' })), /bukan sheet issue/);
});

test('info baris: jam mulai, downtime, status lini, proses dibaca dari K & catatan sel', () => {
  const { gas } = setup();
  const r = find(plain(gas.listIncomplete()), 'Geely list (2)', 18); // 20:15–20:23, Press Modul
  assert.deepEqual([r.start, r.end, r.downtime, r.process, r.lineStatus, r.handling, r.type],
    ['20:15', '20:23', 8, 'Press Modul', 'Mesin pulih', 'Selesai penanganan', 'Mesin']);
  assert.equal(r.downtimeUnverified, false);
});

test('parseNotesInfo_: format Mandarin+English, Bahasa Indonesia, dan Notes bebas manajer', () => {
  const { gas } = setup();
  const bi = '等级：L1；开始：18:05；影响时长：16分钟（未核实）；类型：设备；产线状态：设备已恢复；处理状态：处理完成\n' +
    '(Level: L1; Start: 18:05; Downtime: 16 min (unverified); Type: Machine; Line status: Machine recovered; Handling: Handling completed)';
  assert.deepEqual(plain(gas.parseNotesInfo_(bi, '')),
    { start: '18:05', downtime: 16, unverified: true, type: 'Machine', lineStatus: 'Machine recovered', handling: 'Handling completed' });
  assert.deepEqual(plain(gas.parseNotesInfo_(bi, 'Asli (ID): Level: L1 | Jenis: Mesin | Lini: Mesin pulih | Penanganan: Selesai\n⚠ x')),
    { start: '18:05', downtime: 16, unverified: true, type: 'Mesin', lineStatus: 'Mesin pulih', handling: 'Selesai' });
  const id = 'Level: L1 | Mulai: 7:40 | Durasi: 25 menit | Jenis: Mesin | Lini: - | Penanganan: sudah penanganan\n⚠ ⑦-1 Status lini tidak ada';
  assert.deepEqual(plain(gas.parseNotesInfo_(id, '')),
    { start: '7:40', downtime: 25, unverified: false, type: 'Mesin', lineStatus: '', handling: 'sudah penanganan' });
  assert.deepEqual(plain(gas.parseNotesInfo_('建议：工单下发SOP\n(Recommendation: SOP for Work Order Issuance)', '')),
    { start: '', downtime: null, unverified: false, type: '', lineStatus: '', handling: '' });
});

test('PIC: daftar nama dari kolom I semua sheet (ejaan terbanyak menang), simpan PIC dari pemilih', () => {
  const { gas, geely, ss } = setup();
  ss.getSheetByName('LImo 7 list').set('C9', 'x').set('I9', 'Muhamad gilang, Budi').set('I10', 'iqbal');
  const list = plain(gas.listIncomplete());
  assert.deepEqual(list.roster.map((p) => [p.name, p.count]),
    [['Muhamad gilang', 2], ['Alvansa', 1], ['Budi', 1], ['iqbal', 1]]);
  const r = find(list, 'Geely list (2)', 18);
  assert.equal(r.pic, 'muhamad gilang');
  const after = plain(gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: Object.assign(expectOf(r), { pic: r.pic }),
    pic: 'Muhamad gilang, iqbal, Budi, Alvansa, Rina, iqbal' }));
  assert.equal(geely.get('I18'), 'Muhamad gilang, iqbal, Budi, Alvansa, Rina'); // >4 nama, duplikat dibuang
  assert.equal(after.pic, 'Muhamad gilang, iqbal, Budi, Alvansa, Rina');
  geely.set('I18', 'orang lain');
  assert.throws(() => gas.saveCompletion({ sheet: r.sheet, row: r.row, expect: Object.assign(expectOf(r), { pic: after.pic }), pic: 'iqbal' }),
    /sudah berubah sejak daftar dimuat/);
});
