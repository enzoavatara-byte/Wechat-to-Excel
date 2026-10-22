/**
 * Test parser (src/Parser.gs) tanpa Google. Jalankan: npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, plain, readFixture } = require('./helpers');

const gas = loadGas(['Config.gs', 'Parser.gs']);
const SAMPLE = readFixture('sample.txt');

// Array dari context vm punya prototype lain: Array.from() supaya deepStrictEqual bisa membandingkan.
const times = (recs) => Array.from(recs, (r) => gas.fmtTime_(r.start.time));
const msgs = (rec) => Array.from(rec.warnings, (w) => w.msg);
const byStart = (recs, hm) => recs.find((r) => gas.fmtTime_(r.start.time) === hm);

function report(overrides) {
  const f = Object.assign({
    '①': 'Tingkat saat ini: L1',
    '②': 'Nama proyek: E245',
    '③': 'Nama proses: Finishing',
    '④': 'Waktu kejadian:2026.10.20/18:05',
    '⑤': 'Deskripsi : mesin lem stuck',
    '⑥-1': 'Jenis masalah: Mesin',
    '⑥-2': 'Respond PIC : @iqbal',
    '⑦-1': 'Status lini produksi: Mesin pulih',
    '⑦-2': 'Status Penanganan: Selesai penanganan',
    '⑧': 'Waktu penutupan:2026.10.20/18:23',
    '⑨': 'Durasi dampak: 18 menit'
  }, overrides);
  return Object.keys(f).filter((k) => f[k] !== null).map((k) => k + f[k]).join('\n');
}

// ---------- Fixture: 5 laporan asli ----------

test('fixture: 5 laporan, urut dari jam kejadian paling awal', () => {
  const recs = gas.parseReports(SAMPLE);
  assert.equal(recs.length, 5);
  assert.deepEqual(times(recs), ['17:20', '18:05', '19:15', '20:15', '21:24']);
  assert.deepEqual(Array.from(recs, (r) => r.id), [0, 1, 2, 3, 4]);
});

test('fixture: durasi dihitung ulang dari ④ dan ⑧, cocok dengan ⑨', () => {
  const recs = gas.parseReports(SAMPLE);
  assert.deepEqual(Array.from(recs, (r) => r.duration), [20, 18, 12, 8, 16]);
  assert.deepEqual(Array.from(recs, (r) => r.reportedDuration), [20, 18, 12, 8, 16]);
  recs.forEach((r) => assert.ok(!msgs(r).some((m) => m.includes('⑨')), msgs(r).join('; ')));
});

test('fixture: Mesin/mesin -> Machine; Change over -> kosong + peringatan + default dilewati', () => {
  const recs = gas.parseReports(SAMPLE);
  for (const hm of ['20:15', '21:24']) {
    const r = byStart(recs, hm);
    assert.equal(r.discipline, 'Machine');
    assert.equal(r.skip, false);
    assert.deepEqual(plain(r.warnings), [], hm);
  }
  for (const hm of ['17:20', '18:05', '19:15']) {
    const r = byStart(recs, hm);
    assert.equal(r.type, 'Change over');
    assert.equal(r.discipline, '');
    assert.equal(r.skip, true);
    assert.equal(r.missing.DISCIPLINE, true);
    assert.deepEqual(plain(r.warnings), [
      { col: 'DISCIPLINE', msg: '⑥-1 jenis "Change over" belum dipetakan ke Discipline' }
    ]);
  }
});

test('fixture: PIC tanpa "@", digabung ", " apa adanya', () => {
  const recs = gas.parseReports(SAMPLE);
  assert.equal(byStart(recs, '18:05').pic, 'iqbal, M Arif Rahman, Muhamad gilang');
  assert.equal(byStart(recs, '19:15').pic, 'iqbal, Muhamad gilang');
  assert.equal(byStart(recs, '20:15').pic, 'muhamad gilang');
  assert.equal(byStart(recs, '21:24').pic, 'Alvansa');
});

test('fixture: Machine = "② - ③" (spasi dirapikan, huruf tidak diubah)', () => {
  const recs = gas.parseReports(SAMPLE);
  assert.deepEqual(Array.from(recs, (r) => r.machine), [
    'E245 - Preassy', 'E245 - Finishing', 'E245 - Finishing', 'E245 - Press Modul', 'E245 - finishing'
  ]);
});

test('fixture: nilai kolom G/J berupa nomor seri + daftar kolom kosong', () => {
  const recs = gas.parseReports(SAMPLE);
  const ok = gas.buildRow_(byStart(recs, '20:15'));
  assert.equal(ok.values.DATE, 46315); // 2026/10/20
  assert.equal(ok.values.END_TIME, (20 * 60 + 23) / 1440);
  assert.equal(ok.values.DISCIPLINE, 'Machine');
  assert.deepEqual(Array.from(ok.empty), ['ROOT_CAUSE', 'SOLUTION']);
  assert.deepEqual(plain(ok.notes), {}); // tanpa terjemahan: tidak ada catatan sel

  const co = gas.buildRow_(byStart(recs, '18:05'));
  assert.deepEqual(Array.from(co.empty), ['ROOT_CAUSE', 'SOLUTION', 'DISCIPLINE']);
  assert.equal(co.values.NOTES,
    'Level: L1 | Mulai: 18:05 | Durasi: 18 menit | Jenis: Change over | Lini: Mesin pulih | Penanganan: Selesai penanganan\n' +
    '⚠ ⑥-1 jenis "Change over" belum dipetakan ke Discipline');
});

test('fixture: E245 -> "Geely list (2)", proyek lain -> sheet pilihan', () => {
  const [r] = gas.parseReports(SAMPLE);
  assert.equal(gas.targetSheetName_(r, 'LImo 7 list'), 'Geely list (2)');
  assert.equal(gas.targetSheetName_(gas.parseOne(report({ '②': 'Nama proyek: e-245' })), 'X'), 'Geely list (2)');
  assert.equal(gas.targetSheetName_(gas.parseOne(report({ '②': 'Nama proyek: Limo7' })), 'LImo 7 list'), 'LImo 7 list');
});

// ---------- Ketahanan format ----------

test('parseDateTime: variasi spasi, pemisah, titik sebagai pemisah jam', () => {
  const cases = {
    '2026.10.20/18:05': [2026, 10, 20, 18, 5],
    '2026.10.20/ 21:24': [2026, 10, 20, 21, 24],
    '2026.10.20 / 21:24': [2026, 10, 20, 21, 24],
    '2026.10.20/17.20': [2026, 10, 20, 17, 20],
    '2026-10-20 8:05': [2026, 10, 20, 8, 5],
    '2026/10/20/18 : 05': [2026, 10, 20, 18, 5],
    '2026.1.5/07:30:15': [2026, 1, 5, 7, 30]
  };
  for (const [s, [y, m, d, h, mi]] of Object.entries(cases)) {
    assert.deepEqual(plain(gas.parseDateTime(s)), { date: { y, m, d }, time: { h, mi } }, s);
  }
});

test('parseDateTime: tanggal salah -> null, jam tetap dibaca bila jelas', () => {
  assert.deepEqual(plain(gas.parseDateTime('20/10/2026 18:05')), { date: null, time: { h: 18, mi: 5 } });
  assert.deepEqual(plain(gas.parseDateTime('20.10.2026/18:05')), { date: null, time: { h: 18, mi: 5 } });
  assert.deepEqual(plain(gas.parseDateTime('2026.13.40/18:05')), { date: null, time: { h: 18, mi: 5 } });
  assert.deepEqual(plain(gas.parseDateTime('2026.02.30/18:05')), { date: null, time: { h: 18, mi: 5 } });
  assert.deepEqual(plain(gas.parseDateTime('26.10.20/18:05')), { date: null, time: { h: 18, mi: 5 } });
  assert.deepEqual(plain(gas.parseDateTime('2026.10.20/25:70')), { date: { y: 2026, m: 10, d: 20 }, time: null });
  assert.deepEqual(plain(gas.parseDateTime('kemarin sore')), { date: null, time: null });
});

test('⑨ dengan/tanpa "menit", huruf besar/kecil, jam', () => {
  const dur = (s) => gas.parseOne(report({ '⑨': s })).reportedDuration;
  assert.equal(dur('Durasi dampak: 18 menit'), 18);
  assert.equal(dur('Durasi dampak: 18 Menit'), 18);
  assert.equal(dur('Durasi dampak: 18'), 18);
  assert.equal(dur('Durasi dampak: 18mnt'), 18);
  assert.equal(dur('Durasi dampak : 18 menit '), 18);
  assert.equal(dur('Durasi: 1 jam 5 menit'), 65);
});

test('titik dua full-width, angka full-width, CRLF, spasi mention WeChat, baris diawali spasi', () => {
  const text = [
    '  ①Tingkat saat ini：L1',
    '②Nama proyek：E245',
    '  ③Nama proses ： Finishing',
    '④Waktu kejadian：２０２６.１０.２０／１８：０５',
    '⑤Deskripsi：mesin lem stuck',
    '⑥-1Jenis masalah：MESIN',
    '⑥-2Respond PIC：@iqbal @M Arif Rahman ',
    '⑦-1Status lini produksi：Mesin pulih',
    '⑦-2Status Penanganan：Selesai',
    '⑧Waktu penutupan：2026.10.20/18:23',
    '⑨Durasi dampak：18 menit'
  ].join('\r\n');
  const [r] = gas.parseReports(text);
  assert.equal(r.machine, 'E245 - Finishing');
  assert.equal(gas.fmtDate_(r.start.date), '2026/10/20');
  assert.equal(gas.fmtTime_(r.start.time), '18:05');
  assert.equal(r.discipline, 'Machine');
  assert.equal(r.pic, 'iqbal, M Arif Rahman');
  assert.equal(r.duration, 18);
  assert.deepEqual(plain(r.warnings), []);
});

test('label berbeda tetap terbaca: parsing dikunci pada simbol, bukan label', () => {
  const r = gas.parseOne(report({
    '②': 'Project : E245',
    '④': ' Jam kejadian: 2026.10.20/18:05',
    '⑤': 'Masalah: error code: E136',
    '⑥-2': 'PIC: @iqbal, @gilang'
  }));
  assert.equal(r.project, 'E245');
  assert.equal(gas.fmtTime_(r.start.time), '18:05');
  assert.equal(r.description, 'error code: E136');
  assert.equal(r.pic, 'iqbal, gilang');
});

test('beberapa laporan tanpa baris kosong + ⑥/⑦ tanpa -1/-2', () => {
  const a = report({ '⑥-1': null, '⑥-2': null });
  const withBare = a.replace('⑦-1', '⑥Jenis masalah: Mesin\n⑥Respond PIC: @iqbal\n⑦-1');
  const recs = gas.parseReports(withBare + '\n' + report({ '④': 'Waktu kejadian:2026.10.20/09:00', '⑧': 'Waktu penutupan:2026.10.20/09:18' }));
  assert.equal(recs.length, 2);
  assert.deepEqual(times(recs), ['9:00', '18:05']);
  assert.equal(recs[1].type, 'Mesin');
  assert.equal(recs[1].pic, 'iqbal');
});

test('deskripsi beberapa baris dipertahankan', () => {
  const r = gas.parseOne(report({ '⑤': 'Deskripsi :\n 1. lem habis \n2. nozzle buntu' }));
  assert.equal(r.description, '1. lem habis\n2. nozzle buntu');
});

// ---------- Kasus rusak: jangan mengarang data ----------

test('field hilang: tanpa ⑧ -> G kosong, durasi tidak dihitung', () => {
  const r = gas.parseOne(report({ '⑧': null }));
  assert.equal(r.end.time, null);
  assert.equal(r.duration, null);
  assert.ok(msgs(r).includes('⑧ Waktu penutupan tidak ada'));
  const row = gas.buildRow_(r);
  assert.equal(row.values.END_TIME, '');
  assert.ok(row.empty.includes('END_TIME'));
  assert.ok(row.values.NOTES.includes('Durasi: 18 menit (dari ⑨, belum diverifikasi)'));
});

test('field hilang: tanpa ①, ⑤, ⑥-2 -> kosong + peringatan', () => {
  const r = gas.parseOne(report({ '①': null, '⑤': null, '⑥-2': null }));
  assert.equal(r.level, '');
  assert.equal(r.description, '');
  assert.equal(r.pic, '');
  assert.equal(r.writable, true); // Machine masih ada
  assert.deepEqual(msgs(r), ['① Level tidak ada', '⑤ Deskripsi tidak ada', '⑥-2 PIC tidak ada']);
  assert.deepEqual(Array.from(gas.buildRow_(r).empty), ['ROOT_CAUSE', 'SOLUTION', 'DESC', 'PIC']);
});

test('field kosong atau "-" dianggap kosong', () => {
  const r = gas.parseOne(report({ '③': 'Nama proses: -', '⑥-2': 'Respond PIC :   ' }));
  assert.equal(r.process, '');
  assert.equal(r.machine, 'E245');
  assert.equal(r.missing.MACHINE, true);
  assert.ok(msgs(r).includes('③ Proses kosong'));
  assert.ok(msgs(r).includes('⑥-2 PIC kosong'));
});

test('format tanggal salah: J kosong, teks asli masuk peringatan', () => {
  const r = gas.parseOne(report({ '④': 'Waktu kejadian: 20/10/2026 18:05' }));
  assert.equal(r.start.date, null);
  assert.equal(gas.fmtTime_(r.start.time), '18:05');
  assert.equal(r.duration, null);
  assert.ok(msgs(r).includes('④ Waktu kejadian tanggal tidak terbaca: "20/10/2026 18:05"'));
  const row = gas.buildRow_(r);
  assert.equal(row.values.DATE, '');
  assert.ok(row.empty.includes('DATE'));
});

test('tanpa ":" pada field teks -> kosong, teks asli disimpan di peringatan', () => {
  const r = gas.parseOne(report({ '⑤': 'Deskripsi mesin macet' }));
  assert.equal(r.description, '');
  assert.ok(msgs(r).includes('⑤ Deskripsi tanpa ":" (label & isi tidak bisa dipisah): "Deskripsi mesin macet"'));
});

test('teks tanpa simbol ①–⑨ -> tidak ada laporan', () => {
  assert.equal(gas.parseReports('Halo semua, mesin sudah normal ya. Terima kasih').length, 0);
  assert.equal(gas.parseReports('').length, 0);
  assert.equal(gas.parseReports(null).length, 0);
});

test('laporan tanpa ① tetap terbaca dan terpisah dari laporan sebelumnya', () => {
  const second = report({ '①': null, '④': 'Waktu kejadian:2026.10.20/19:00', '⑧': 'Waktu penutupan:2026.10.20/19:10', '⑨': 'Durasi dampak: 10' });
  const recs = gas.parseReports(report() + '\n' + second);
  assert.equal(recs.length, 2);
  assert.deepEqual(times(recs), ['18:05', '19:00']);
  assert.deepEqual(msgs(recs[1]), ['① Level tidak ada']);
});

test('Machine dan Deskripsi kosong -> tidak bisa ditulis', () => {
  const r = gas.parseOne(report({ '②': null, '③': null, '⑤': null }));
  assert.equal(r.writable, false);
  assert.ok(msgs(r).includes('Machine (②③) dan Deskripsi (⑤) kosong — tidak bisa ditulis'));
});

test('⑨ beda dengan hitungan ④→⑧ -> peringatan', () => {
  const r = gas.parseOne(report({ '⑨': 'Durasi dampak: 30 menit' }));
  assert.equal(r.duration, 18);
  assert.deepEqual(msgs(r), ['⑨ tertulis 30 menit, hitungan ④→⑧ = 18 menit']);
});

test('⑨ tidak terbaca -> peringatan, durasi tetap dari ④→⑧', () => {
  const r = gas.parseOne(report({ '⑨': 'Durasi dampak: lama' }));
  assert.equal(r.reportedDuration, null);
  assert.equal(r.duration, 18);
  assert.deepEqual(msgs(r), ['⑨ Durasi tidak terbaca: "lama"']);
});

test('⑧ lebih awal dari ④ -> durasi kosong + peringatan', () => {
  const r = gas.parseOne(report({ '⑧': 'Waktu penutupan:2026.10.20/17:00' }));
  assert.equal(r.duration, null);
  assert.ok(msgs(r).includes('⑧ lebih awal dari ④ — cek tanggal/jam'));
});

test('lewat tengah malam: durasi benar, tanggal selesai dicatat di Notes', () => {
  const r = gas.parseOne(report({
    '④': 'Waktu kejadian:2026.10.20/23:50',
    '⑧': 'Waktu penutupan:2026.10.21/00:30',
    '⑨': 'Durasi dampak: 40 menit'
  }));
  assert.equal(r.duration, 40);
  assert.deepEqual(plain(r.warnings), []);
  assert.ok(gas.buildNotes_(r).includes('Selesai: 2026/10/21 0:30'));
});

test('laporan yang sama di-paste dua kali -> yang kedua ditandai duplikat', () => {
  const recs = gas.parseReports(report() + '\n\n' + report());
  assert.equal(recs.length, 2);
  assert.equal(recs[0].duplicateOf, undefined);
  assert.deepEqual(plain(recs[1].duplicateOf), { where: 'paste', id: 0 });
});

test('Discipline dipilih manual di pratinjau', () => {
  const co = () => gas.parseReports(SAMPLE)[1]; // 18:05 Change over
  const r = gas.applyDisciplineChoice_(co(), 'Operation');
  assert.equal(r.discipline, 'Operation');
  assert.equal(r.missing.DISCIPLINE, false);
  assert.deepEqual(plain(r.warnings), []);
  assert.ok(gas.buildNotes_(r).includes('Discipline dipilih manual'));
  assert.deepEqual(Array.from(gas.buildRow_(r).empty), ['ROOT_CAUSE', 'SOLUTION']);

  const bad = gas.applyDisciplineChoice_(co(), 'Bukan dropdown');
  assert.equal(bad.discipline, '');
  assert.equal(bad.disciplineManual, false);
});
