/**
 * Test "✎ Edit" di layar Periksa (src/Edit.gs): isi sel diubah sebelum impor.
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
  return { ss, gas, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)') };
}

// id 3 = 20:15 (E245 - Press Modul), id 4 = 21:24; keduanya default dicentang.
const imp = (gas, cells3, cells4) => plain(gas.importWeChat(SAMPLE, 'LImo 7 list', [
  { id: 3, discipline: 'Machine', cells: cells3 || {} },
  { id: 4, discipline: 'Machine', cells: cells4 || {} }
]));

test('teks Mandarin yang diperbaiki manual ditulis apa adanya; catatan C/D tetap teks asli laporan', () => {
  const { gas, geely } = setup();
  const res = imp(gas, { MACHINE: 'E245模组压装工位\n(E245 Module Press Station)', DESC: '喷嘴未对准托盘\n(Nozzle misaligned with pallet)' });
  assert.deepEqual(res.errors, []);
  assert.equal(geely.get('C18'), 'E245模组压装工位\n(E245 Module Press Station)');
  assert.equal(geely.get('D18'), '喷嘴未对准托盘\n(Nozzle misaligned with pallet)');
  assert.equal(geely.note('C18'), 'Asli (ID): E245 - Press Modul');
  assert.equal(geely.note('D18'), 'Asli (ID): Posisi nozzle tidak masuk pada pallet');
  assert.equal(res.written[0].cells.C, 'E245模组压装工位\n(E245 Module Press Station)');
});

test('teks Bahasa Indonesia yang diketik di C/D/E/F diterjemahkan saat impor (C tetap format proyek+proses)', () => {
  const { gas, geely, tr } = setup();
  const res = imp(gas, {
    MACHINE: 'E245 - Press Modul',
    DESC: 'posisi nozzle\ntidak pas',
    ROOT_CAUSE: 'baut fixture longgar',
    SOLUTION: '- kencangkan baut'
  });
  assert.deepEqual(res.errors, []);
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)');
  assert.equal(geely.get('D18'), '中:EN:posisi nozzle\n中:EN:tidak pas\n(EN:posisi nozzle\nEN:tidak pas)');
  assert.equal(geely.get('E18'), '中:EN:baut fixture longgar\n(EN:baut fixture longgar)');
  assert.equal(geely.get('F18'), '中:EN:- kencangkan baut\n(EN:- kencangkan baut)');
  assert.equal(geely.note('E18'), 'Asli (ID): baut fixture longgar');
  assert.equal(geely.note('F18'), 'Asli (ID): - kencangkan baut');
  // Hasil parser + isian edit diterjemahkan dalam satu putaran (satu panggilan per bahasa).
  assert.deepEqual(tr.calls.map((c) => c.from + '>' + c.to), ['id>en', 'en>zh-CN', 'id>en', 'en>zh-CN']);
  const w = res.written[0];
  assert.deepEqual(w.empty.map((e) => e.col), []); // E & F terisi
  assert.equal(w.description, 'posisi nozzle\ntidak pas'); // teks mentor memakai Bahasa Indonesia yang diketik
});

test('G, I, J bisa diubah; format jam/tanggal divalidasi', () => {
  const { gas, geely } = setup();
  const res = imp(gas, { END_TIME: '20.30', PIC: '  Budi  Santoso ', DATE: '2026-10-21' });
  assert.deepEqual(res.errors, []);
  assert.equal(geely.get('G18'), (20 * 60 + 30) / 1440);
  assert.equal(geely.get('I18'), 'Budi Santoso');
  assert.equal(geely.get('J18'), 46316);
  assert.equal(geely.fmt('J18'), 'yyyy/mm/dd');
  const w = res.written[0];
  assert.deepEqual([w.end, w.pic, w.date], ['20:30', 'Budi Santoso', '2026/10/21']);
});

test('jam/tanggal tidak valid -> laporan itu tidak ditulis, laporan lain tetap ditulis', () => {
  const { gas, geely } = setup();
  const res = imp(gas, { END_TIME: '25:99', DATE: '21/10/2026' });
  assert.equal(res.written.length, 1);
  assert.equal(res.written[0].start, '21:24');
  assert.equal(res.written[0].row, 18);
  assert.match(res.errors[0], /^20:15 E245 - Press Modul: G "25:99" tidak valid .*; J "21\/10\/2026" tidak valid .*Tidak ditulis\.$/);
  assert.equal(geely.get('C19'), undefined);
});

test('C dan D dikosongkan dua-duanya -> ditolak', () => {
  const { gas } = setup();
  const res = imp(gas, { MACHINE: '', DESC: '  ' });
  assert.match(res.errors[0], /Machine \(C\) dan Deskripsi \(D\) tidak boleh kosong dua-duanya/);
  assert.equal(res.written.length, 1);
});

test('G/J/I dikosongkan dengan sengaja -> sel kosong, masuk daftar perlu dilengkapi', () => {
  const { gas, geely } = setup();
  const res = imp(gas, { END_TIME: '', PIC: '', DATE: '' });
  assert.equal(geely.get('G18'), '');
  assert.equal(geely.get('I18'), '');
  assert.equal(geely.get('J18'), '');
  assert.deepEqual(res.written[0].empty.map((e) => e.col), ['E', 'F', 'G', 'I', 'J']);
});

test('terjemahan isian gagal -> tidak ada yang ditulis sama sekali', () => {
  const { gas, geely, tr } = setup();
  tr.fail = true;
  assert.throws(() => imp(gas, { ROOT_CAUSE: 'baut longgar' }), /Terjemahan gagal, tidak ada yang ditulis/);
  assert.equal(geely.get('C18'), undefined);
});

test('tanpa terjemahan: isian ditulis apa adanya', () => {
  const { gas, geely } = setup();
  plain(gas.importWeChat(SAMPLE, 'LImo 7 list', [{ id: 3, cells: { ROOT_CAUSE: 'baut longgar' } }], { translate: false }));
  assert.equal(geely.get('E18'), 'baut longgar');
  assert.equal(geely.note('E18'), '');
});

test('tombol ↻ Terjemahkan (translateCell): pratinjau satu sel tanpa menulis', () => {
  const { gas, ss } = setup();
  assert.equal(gas.translateCell('MACHINE', 'E245 - Press Modul').value, 'E245模组压装\n(E245 Module Press)');
  assert.equal(gas.translateCell('ROOT_CAUSE', 'baut longgar').value, '中:EN:baut longgar\n(EN:baut longgar)');
  assert.equal(gas.translateCell('DESC', '已有中文\n(Already)').value, '已有中文\n(Already)');
  assert.throws(() => gas.translateCell('DISCIPLINE', 'Machine'), /tidak diterjemahkan/);
  assert.ok(ss.getSheets().every((sh) => sh.writes === 0));
});
