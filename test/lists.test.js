/**
 * Daftar PIC & Daftar Mesin yang diatur sendiri di spreadsheet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const LIMO = readFixture('limo7.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Dashboard.gs', 'Ui.gs'];

function setup() {
  const ss = managerSpreadsheet();
  const svc = services(ss);
  const gas = loadGas(FILES, svc);
  return { ss, gas, tr: svc.LanguageApp, geely: ss.getSheetByName('Geely list (2)') };
}
const rowsOf = (sh, from, to, cols) => Array.from({ length: to - from + 1 }, (_, i) => cols.map((c) => sh.get(c + (from + i))));

test('Daftar PIC: dibuat berisi nama yang dipakai; setelah dirapikan pemilih hanya memakai daftar itu', () => {
  const { ss, gas, geely } = setup();
  geely.set('I9', 'Muhamad gilang, Budi').set('I10', 'muhamad gilang').set('I11', 'imam 學者們');
  assert.equal(plain(gas.getInitData()).picList.managed, false);
  const res = plain(gas.openPicList());
  assert.equal(res.created, true);
  assert.match(res.url, /#gid=\d+$/);
  const sh = ss.getSheetByName('Daftar PIC');
  assert.deepEqual(rowsOf(sh, 1, 4, ['A']).map((r) => r[0]), ['Nama PIC', 'Muhamad gilang', 'Budi', 'imam 學者們']);
  assert.equal(plain(gas.openPicList()).created, false); // tidak pernah menimpa

  // Dirapikan: hapus "imam 學者們", tambah Imam dengan nama lain di WeChat.
  sh.set('A4', 'Imam').set('B4', '牧師 imam, imam 學者們').set('A5', 'Iqbal');
  const init = plain(gas.getInitData());
  assert.equal(init.picList.managed, true);
  assert.deepEqual(init.roster.map((p) => p.name), ['Muhamad gilang', 'Budi', 'Imam', 'Iqbal']);

  // Nama lain di WeChat diganti ke nama di daftar saat pratinjau & impor.
  const p = plain(gas.previewWeChat(LIMO, 'LImo 7 list'));
  assert.equal(p.records[0].pic, 'Imam, Iqbal'); // dari "@牧師 imam @Iqbal"
  assert.deepEqual(plain(gas.addPicName('  Rina   Putri ')), { added: true, managed: true, name: 'Rina Putri' });
  assert.deepEqual(plain(gas.addPicName('iqbal')), { added: false, managed: true, name: 'Iqbal' });
  assert.equal(sh.get('A6'), 'Rina Putri');
});

test('Daftar PIC belum ada: addPicName tidak membuat apa pun; pemilih tetap otomatis dari kolom I', () => {
  const { ss, gas } = setup();
  assert.deepEqual(plain(gas.addPicName('Rina')), { added: false, managed: false, name: 'Rina' });
  assert.equal(ss.getSheetByName('Daftar PIC'), null);
});

test('Daftar Mesin: dibuat dari nama Machine yang dipakai (ejaan terbanyak, nama ③ asli dari catatan sel)', () => {
  const { ss, gas, geely } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline })));
  geely.set('C9', '终检\n(Finishing)').set('C10', '终检\n(Finishing)');
  const res = plain(gas.openMachineList());
  assert.equal(res.created, true);
  const sh = ss.getSheetByName('Daftar Mesin');
  assert.deepEqual(rowsOf(sh, 1, 4, ['A', 'B', 'C', 'D']), [
    ['中文', 'English', 'Proyek (kosong = semua proyek)', 'Nama di laporan ③ (pisahkan koma)'],
    ['终检', 'Finishing', '', ''],                   // 2× (diketik manual, tanpa catatan sel)
    ['E245模组压装', 'E245 Module Press', '', 'Press Modul'],
    ['E245精加工', 'E245 finishing', '', 'finishing']
  ]);
  assert.equal(res.machines.length, 3);
  assert.equal(plain(gas.getInitData()).machineList.managed, true);
});

test('Daftar Mesin: ③ yang cocok memakai teks daftar (tanpa terjemahan mesin); pilihan manual dipelajari', () => {
  const { ss, gas, tr, geely } = setup();
  gas.createIssueSheet({ sheetName: 'Limo list (2)' }); // tujuan DJ2518 (Config)
  const sh = ss.insertSheet('Daftar Mesin');
  sh.set('A1', '中文').set('B1', 'English').set('C1', 'Proyek').set('D1', 'Nama di laporan');
  sh.set('A2', '终检').set('B2', 'Finishing').set('C2', 'E245');
  sh.set('A3', '模组压装').set('B3', 'Module Press').set('D3', 'press modul');
  sh.set('A4', 'B线在线电芯输送线').set('B4', 'Cell Online Conveyor Line B').set('C4', 'DJ2518');

  const p = plain(gas.previewWeChat(SAMPLE + '\n\n' + LIMO, 'LImo 7 list'));
  const fin = p.records.find((r) => r.start === '21:24'); // E245 finishing
  const press = p.records.find((r) => r.start === '20:15'); // E245 Press Modul
  const cell = p.records.find((r) => r.start === '7:30');   // DJ2518 cell online Line B
  assert.deepEqual([fin.cells.C, fin.machineRow], ['终检\n(Finishing)', 2]);
  assert.deepEqual([press.cells.C, press.machineRow], ['模组压装\n(Module Press)', 3]);
  assert.equal(cell.machineRow, null); // "cell online Line B" belum dikenal
  assert.ok(cell.warnings.some((w) => /belum ada di Daftar Mesin/.test(w.msg)));
  // Proses dari daftar tidak dikirim ke Google Translate.
  const sent = tr.calls.map((c) => c.text).join('|');
  assert.ok(sent.includes('cell online Line B')); // yang belum dikenal tetap diterjemahkan
  assert.ok(!/Press Modul|finishing/i.test(sent));

  const res = plain(gas.importWeChat(SAMPLE + '\n\n' + LIMO, 'LImo 7 list', [
    { id: fin.id }, { id: cell.id, machine: 4 }]));
  assert.deepEqual(res.errors, []);
  const w = res.written.find((x) => x.start === '7:30');
  const limo = ss.getSheetByName(w.sheet);
  assert.equal(limo.get('C' + w.row), 'B线在线电芯输送线\n(Cell Online Conveyor Line B)');
  assert.equal(limo.note('C' + w.row), 'Asli (ID): DJ2518 - VFLimo7 - cell online Line B');
  assert.equal(sh.get('D4'), 'cell online Line B'); // dipelajari
  // Paste berikutnya: cocok otomatis.
  const again = plain(gas.previewWeChat(LIMO.replace('07:30', '11:00').replace('09:05', '11:30'), 'LImo 7 list'));
  assert.equal(again.records[0].machineRow, 4);
  const f = res.written.find((x) => x.start === '21:24');
  assert.equal(geely.get('C' + f.row), '终检\n(Finishing)');
});

test('Lengkapi: Machine (C) bisa diganti ke entri Daftar Mesin; teks asli tetap di catatan sel', () => {
  const { ss, gas, geely } = setup();
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  gas.importWeChat(SAMPLE, 'LImo 7 list', p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline })));
  const sh = ss.insertSheet('Daftar Mesin');
  sh.set('A1', '中文').set('B1', 'English').set('A2', '模组压装').set('B2', 'Module Press');
  const list = plain(gas.listIncomplete());
  assert.equal(list.machines[0].row, 2);
  const r = list.rows.find((x) => x.sheet === 'Geely list (2)' && x.row === 18);
  assert.equal(r.project, 'E245');
  const after = plain(gas.saveCompletion({ sheet: r.sheet, row: r.row, machine: 2,
    expect: { machine: r.machine, description: r.description, rootCause: r.rootCause, solution: r.solution, discipline: r.discipline } }));
  assert.equal(geely.get('C18'), '模组压装\n(Module Press)');
  assert.equal(geely.note('C18'), 'Asli (ID): E245 - Press Modul');
  assert.equal(after.machine, '模组压装\n(Module Press)');
  assert.equal(sh.get('D2'), 'Press Modul');
});
