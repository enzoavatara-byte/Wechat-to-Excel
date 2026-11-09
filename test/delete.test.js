/**
 * Hapus baris lewat tool (laporan yang tidak seharusnya di-upload) + tanggal dari sel bertanggal asli.
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
  const gas = loadGas(FILES, services(ss));
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  const res = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', p.records.filter((r) => r.include).map((r) => ({ id: r.id, discipline: r.discipline }))));
  return { ss, gas, geely: ss.getSheetByName('Geely list (2)'), res };
}
const col = (sh, c, from, to) => Array.from({ length: to - from + 1 }, (_, i) => sh.get(c + (from + i)));
const expectOf = (sh, row) => ({ machine: String(sh.get('C' + row) || '').replace(/^'/, ''), description: String(sh.get('D' + row) || '').replace(/^'/, '') });

test('hapus laporan terakhir (salah impor): baris hilang, nomornya dipakai lagi, salinan di log tersembunyi', () => {
  const { ss, gas, geely, res } = setup();
  assert.deepEqual(res.written.map((w) => [w.row, w.no]), [[18, 10], [19, 11]]);
  const out = plain(gas.deleteIssueRow({ sheet: 'Geely list (2)', row: 19, expect: expectOf(geely, 19) }));
  assert.deepEqual([out.sheet, out.row, out.no, out.renumbered, out.log], ['Geely list (2)', 19, '11', 3, 'WeChat_Deleted']);
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)'); // baris lain tidak tersentuh
  assert.deepEqual(col(geely, 'B', 18, 22), [10, 11, 12, 13, undefined]); // nomor siap-pakai 12–14 jadi 11–13
  assert.equal(geely.get('C19'), undefined);

  const log = ss.getSheetByName('WeChat_Deleted');
  assert.ok(log.isSheetHidden());
  assert.equal(log.get('A1'), 'Dihapus pada');
  assert.match(String(log.get('A2')), /^'?\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  assert.deepEqual([log.get('B2'), log.get('C2'), log.get('O2'), log.get('P2')],
    ['Geely list (2)', 19, 'E245 - finishing', 'mesin lem upper pack stuck']);
  assert.match(log.get('N2'), /^Asli \(ID\): Level: L1/);

  // Paste ulang chat yang sama: laporan itu ditandai "pernah dihapus" dan tidak dicentang.
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  const again = p.records.find((r) => r.start === '21:24');
  assert.equal(again.deletedBefore.sheet, 'Geely list (2)');
  assert.equal(again.include, false);
  assert.equal(p.records.find((r) => r.start === '20:15').duplicateOf.row, 18);
  // Kalau memang mau dimasukkan lagi (centang manual): masuk ke baris 19 dengan nomor 11 lagi.
  const back = plain(gas.importWeChat(SAMPLE, 'LImo 7 list', [{ id: again.id, discipline: again.discipline }]));
  assert.deepEqual(back.written.map((w) => [w.row, w.no]), [[19, 11]]);
});

test('hapus baris di tengah: baris di bawahnya naik, nomor (ID) laporan lain tidak diubah', () => {
  const { gas, geely } = setup();
  gas.deleteIssueRow({ sheet: 'Geely list (2)', row: 12, expect: expectOf(geely, 12) });
  assert.equal(geely.get('C12'), 'Mesin lama 5');
  assert.deepEqual(col(geely, 'B', 11, 21), [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]); // 4 hilang, sisanya tetap
  const list = plain(gas.listIncomplete());
  assert.ok(!list.rows.some((r) => r.sheet === 'Geely list (2)' && /Masalah lama 4$/.test(r.description)));
  assert.equal(list.rows.find((r) => r.no === '10').row, 17); // hasil impor ikut naik
  const dash = plain(gas.getDashboard()).rows.filter((r) => r.sheet === 'Geely list (2)');
  assert.equal(dash.length, 10);
});

test('hapus ditolak tanpa menulis apa pun: isi berubah, baris kosong, header, sheet bukan issue', () => {
  const { ss, gas, geely } = setup();
  assert.throws(() => gas.deleteIssueRow({ sheet: 'Geely list (2)', row: 18, expect: expectOf(geely, 19) }),
    /sudah berubah sejak daftar dimuat.*tidak ada yang dihapus/);
  assert.throws(() => gas.deleteIssueRow({ sheet: 'Geely list (2)', row: 20, expect: { machine: '', description: '' } }), /kosong/);
  assert.throws(() => gas.deleteIssueRow({ sheet: 'Geely list (2)', row: 8, expect: {} }), /Nomor baris tidak valid/);
  assert.throws(() => gas.deleteIssueRow({ sheet: 'Revision_History', row: 9, expect: {} }), /bukan sheet issue/);
  assert.equal(ss.getSheetByName('WeChat_Deleted'), null);
  assert.equal(geely.get('C18'), 'E245模组压装\n(E245 Module Press)');
  assert.equal(geely.get('C19'), 'E245精加工\n(E245 finishing)');
});

test('tanggal J dari sel bertanggal asli (tampil "11/1/2026" di locale US) dibaca sebagai yyyy/mm/dd', () => {
  const { gas, geely } = setup();
  const d = (s) => new Date(s + 'T00:00:00+08:00');
  geely.set('J12', d('2026-11-01'));
  geely.set('J18', d('2026-10-20')); // baris hasil impor 20:15, kini sel tanggal asli
  const row = plain(gas.listIncomplete()).rows.find((r) => r.sheet === 'Geely list (2)' && r.row === 12);
  assert.equal(row.date, '2026/11/01');
  assert.equal(plain(gas.getDashboard()).rows.find((r) => r.sheet === 'Geely list (2)' && r.row === 12).date, '2026/11/01');
  // Deteksi duplikat tetap jalan walau tampilan tanggalnya beda format.
  const p = plain(gas.previewWeChat(SAMPLE, 'LImo 7 list'));
  assert.equal(p.records.find((r) => r.start === '20:15').duplicateOf.row, 18);
});

test('E/F berisi "-" (sengaja tidak ada) dianggap terisi', () => {
  const { gas, geely } = setup();
  geely.set('E18', '-\n(-)').set('F18', '-');
  const r = plain(gas.listIncomplete()).rows.find((x) => x.sheet === 'Geely list (2)' && x.row === 18);
  assert.equal(r, undefined);
  assert.equal(plain(gas.getDashboard()).rows.find((x) => x.sheet === 'Geely list (2)' && x.row === 18).complete, true);
});
