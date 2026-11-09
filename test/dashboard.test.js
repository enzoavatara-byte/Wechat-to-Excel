/**
 * Test halaman Ringkasan (src/Dashboard.gs).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');
const { managerSpreadsheet, services } = require('./mock-sheets');

const SAMPLE = readFixture('sample.txt');
const FILES = ['Config.gs', 'Parser.gs', 'Translate.gs', 'Sheet.gs', 'Edit.gs', 'Template.gs', 'Complete.gs', 'Dashboard.gs', 'Ui.gs'];

test('ringkasan: semua baris issue dari semua sheet, dengan jam, downtime, proses, kelengkapan', () => {
  const ss = managerSpreadsheet();
  const gas = loadGas(FILES, services(ss));
  gas.importWeChat(SAMPLE, 'LImo 7 list', [{ id: 3, discipline: 'Machine', cells: { END_TIME: '20:40' } }, { id: 4, discipline: 'Machine' }]);
  ss.getSheetByName('Geely list (2)').set('E19', '螺栓松动\n(Loose bolt)').set('F19', '更换\n(Replace)');
  const d = plain(gas.getDashboard());
  assert.equal(d.rows.length, 6 + 9 + 2); // LImo 6 + Geely 9 baris lama + 2 impor
  const r18 = d.rows.find((r) => r.sheet === 'Geely list (2)' && r.row === 18);
  assert.deepEqual([r18.date, r18.start, r18.end, r18.downtime, r18.process, r18.machine, r18.problem, r18.pic, r18.complete],
    ['2026/10/20', '20:15', '20:40', 25, 'Press Modul', 'E245 - Press Modul', 'Posisi nozzle tidak masuk pada pallet', 'muhamad gilang', false]);
  assert.deepEqual(r18.need, ['E', 'F']);
  const r19 = d.rows.find((r) => r.row === 19 && r.sheet === 'Geely list (2)');
  assert.equal(r19.complete, true);
  const old = d.rows.find((r) => r.sheet === 'Geely list (2)' && r.row === 9);
  assert.deepEqual([old.date, old.start, old.downtime], ['2026/10/15', '', null]);
});
