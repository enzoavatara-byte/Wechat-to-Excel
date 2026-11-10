/**
 * Semua akses Google Sheets. Parsing & pemetaan kolom ada di Parser.gs (murni).
 * Fungsi tanpa "_" di akhir nama dipanggil dari UI lewat google.script.run.
 */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ---------- Pengaman sheet ----------

/** Hanya sheet dengan header B8:D8 sesuai HEADER_CHECK yang boleh ditulis. */
function isIssueSheet_(sh) {
  var h = sh.getRange(ROW.HEADER, COL.NO, 1, HEADER_CHECK.length).getDisplayValues()[0];
  return HEADER_CHECK.every(function (want, i) {
    return normHeader_(h[i]).indexOf(normHeader_(want)) === 0;
  });
}

function normHeader_(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function issueSheetNames_(ss) {
  return ss.getSheets().filter(isIssueSheet_).map(function (sh) { return sh.getName(); });
}

// ---------- Daftar PIC ----------

/** "a, b; c" -> ['a', 'b', 'c'] (tanpa duplikat, huruf besar/kecil diabaikan). */
function splitPics_(s) {
  var seen = {};
  return String(s || '').split(/\s*[,;、\n]\s*/).map(function (n) { return n.replace(/\s+/g, ' ').trim(); })
    .filter(function (n) {
      var k = n.toLowerCase();
      if (!n || isBlank_(n) || seen[k]) return false;
      seen[k] = true;
      return true;
    });
}

/**
 * Nama untuk pemilih PIC: PIC_NAMES (Config) + semua nama di kolom I sheet issue, paling sering dipakai
 * dulu. Nama yang sama dengan huruf besar/kecil berbeda digabung (ejaan yang paling sering dipakai menang).
 */
function picRoster_(ss) {
  var list = picList_(ss);
  if (list) return list.names.map(function (n) { return { name: n, count: 0 }; });
  var names = nameCounter_();
  PIC_NAMES.forEach(function (n) { splitPics_(n).forEach(function (x) { names.add(x, 1000, 0); }); });
  issueSheetNames_(ss).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var last = sh.getLastRow();
    if (last < ROW.DATA_START) return;
    sh.getRange(ROW.DATA_START, COL.PIC, last - ROW.DATA_START + 1, 1).getDisplayValues().forEach(function (r) {
      splitPics_(r[0]).forEach(function (x) { names.add(x, 1, 1); });
    });
  });
  return names.list();
}

// ---------- Daftar PIC (sheet yang diatur sendiri) ----------

var PIC_HEADERS = ['Nama PIC', 'Nama lain di WeChat (pisahkan koma)', 'Keterangan'];

/**
 * Isi sheet Daftar PIC: { names: [nama kolom A, urut sheet], alias: {nama/alias huruf kecil -> nama A} },
 * atau null kalau sheet tidak ada / belum berisi nama (pemilih kembali ke mode otomatis).
 */
function picList_(ss) {
  var sh = ss.getSheetByName(PIC_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var names = [];
  var alias = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
    var n = String(r[0]).replace(/\s+/g, ' ').trim();
    if (!n || isBlank_(n) || alias.hasOwnProperty(n.toLowerCase())) return;
    names.push(n);
    alias[n.toLowerCase()] = n;
    splitPics_(r[1]).forEach(function (a) {
      if (!alias.hasOwnProperty(a.toLowerCase())) alias[a.toLowerCase()] = n;
    });
  });
  return names.length ? { names: names, alias: alias } : null;
}

/** "牧師 imam, Iqbal" -> "Imam, Iqbal" kalau "牧師 imam" tercatat sebagai nama lain dari "Imam". */
function mapPics_(pic, list) {
  if (!list || !pic) return pic;
  var seen = {};
  return splitPics_(pic).map(function (n) { return list.alias[n.toLowerCase()] || n; })
    .filter(function (n) { var k = n.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; })
    .join(', ');
}

/** Nama PIC & pelapor hasil parser diganti ke nama di Daftar PIC (kalau tercatat sebagai nama lain). */
function applyPicList_(recs, list) {
  if (!list) return recs;
  recs.forEach(function (r) {
    r.pic = mapPics_(r.pic, list);
    if (r.reporter) r.reporter = list.alias[r.reporter.toLowerCase()] || r.reporter;
  });
  return recs;
}

function picListInfo_(ss) {
  var sh = ss.getSheetByName(PIC_SHEET);
  return sh ? { managed: true, url: ss.getUrl().replace(/#.*$/, '') + '#gid=' + sh.getSheetId() } : { managed: false, url: '' };
}

/**
 * Buat sheet Daftar PIC kalau belum ada, langsung diisi nama yang sekarang dipakai (kolom I, paling sering
 * dulu) supaya tinggal dihapus / dirapikan. Tidak pernah menimpa sheet yang sudah ada.
 */
function openPicList() {
  var ss = ss_();
  var sh = ss.getSheetByName(PIC_SHEET);
  var created = false;
  if (!sh) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Masih ada proses lain yang berjalan. Coba lagi beberapa detik.');
    try {
      var names = picRoster_(ss).map(function (p) { return [asText_(p.name), '', '']; });
      sh = ss.insertSheet(PIC_SHEET, ss.getSheets().length);
      sh.getRange(1, 1, 1, PIC_HEADERS.length).setValues([PIC_HEADERS]).setFontWeight('bold').setBackground('#C6D9F1');
      sh.getRange(1, 1).setNote('Satu nama per baris; urutan di sini = urutan di pemilih PIC. Hapus baris untuk ' +
        'menghilangkan nama. Kolom B: nama lain orang itu di WeChat (mis. "牧師 imam, imam 學者們"), saat impor ' +
        'otomatis diganti ke nama di kolom A. Sheet kosong = nama diambil otomatis dari kolom I.');
      if (names.length) sh.getRange(2, 1, names.length, PIC_HEADERS.length).setValues(names);
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 220);
      sh.setColumnWidth(2, 320);
      sh.setColumnWidth(3, 220);
      created = true;
    } finally {
      lock.releaseLock();
    }
  }
  var info = picListInfo_(ss);
  return { url: info.url, created: created, count: Math.max(0, sh.getLastRow() - 1) };
}

/** "+ Nama lain" di pemilih: nama baru ikut dicatat di Daftar PIC (hanya kalau sheet itu sudah dipakai). */
function addPicName(name) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Nama kosong.');
  var ss = ss_();
  var sh = ss.getSheetByName(PIC_SHEET);
  if (!sh) return { added: false, managed: false, name: name };
  var list = picList_(ss);
  if (list && list.alias.hasOwnProperty(name.toLowerCase())) return { added: false, managed: true, name: list.alias[name.toLowerCase()] };
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  sh.getRange(row, 1).setValue(asText_(name));
  return { added: true, managed: true, name: name };
}

// ---------- Daftar Mesin (sheet yang diatur sendiri) ----------

var MACHINE_HEADERS = ['中文', 'English', 'Proyek (kosong = semua proyek)', 'Nama di laporan ③ (pisahkan koma)'];

/**
 * Isi sheet Daftar Mesin: [{ row, zh, en, project (kunci), projectText, keys: {typeKey_: true} }], atau null.
 * Kunci cocok = kolom English + semua nama di kolom D, huruf besar/kecil, spasi, strip, titik diabaikan.
 */
function machineList_(ss) {
  var sh = ss.getSheetByName(MACHINE_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().forEach(function (r, i) {
    var zh = String(r[0]).trim(), en = String(r[1]).trim();
    if (!zh && !en) return;
    var keys = {};
    [en].concat(splitPics_(r[3])).forEach(function (a) { var k = typeKey_(a); if (k) keys[k] = true; });
    out.push({ row: i + 2, zh: zh || en, en: en || zh, project: projectKey_(r[2]), projectText: String(r[2]).trim(), keys: keys });
  });
  return out.length ? out : null;
}

/** Entri Daftar Mesin untuk ③ laporan ini; entri khusus proyek menang atas entri umum. */
function findMachine_(list, project, process) {
  if (!list || !process) return null;
  var k = typeKey_(process);
  var pk = projectKeys_(project);
  var hit = null;
  list.forEach(function (m) {
    if (!m.keys[k] || (m.project && pk.indexOf(m.project) === -1)) return;
    if (!hit || (m.project && !hit.project)) hit = m;
  });
  return hit;
}

function applyMachineList_(recs, list) {
  if (!list) return recs;
  recs.forEach(function (r) {
    r.machineEntry = findMachine_(list, r.project, r.process);
    if (!r.machineEntry && r.process) {
      warn_(r, null, '③ "' + r.process + '" belum ada di Daftar Mesin: pilih mesin/line di layar Periksa (pilihan dipelajari untuk laporan berikutnya)');
    }
  });
  return recs;
}

/** Pilihan untuk UI: entri Daftar Mesin tanpa kunci internal. */
function machineOptions_(list) {
  return (list || []).map(function (m) { return { row: m.row, zh: m.zh, en: m.en, project: m.project, projectText: m.projectText }; });
}

function machineListInfo_(ss) {
  var sh = ss.getSheetByName(MACHINE_SHEET);
  return sh ? { managed: true, url: ss.getUrl().replace(/#.*$/, '') + '#gid=' + sh.getSheetId() } : { managed: false, url: '' };
}

/** Nama ③ yang dipilih manual ke entri ini ditambahkan ke kolom D, supaya laporan berikutnya cocok otomatis. */
function learnMachineAliases_(ss, learns) {
  var sh = ss.getSheetByName(MACHINE_SHEET);
  if (!sh) return;
  var byRow = {};
  learns.forEach(function (l) {
    if (!l.alias || l.entry.keys[typeKey_(l.alias)]) return;
    (byRow[l.entry.row] = byRow[l.entry.row] || []).push(l.alias);
  });
  Object.keys(byRow).forEach(function (row) {
    var cell = sh.getRange(Number(row), 4);
    var have = splitPics_(cell.getDisplayValues()[0][0]);
    byRow[row].forEach(function (a) { if (!have.some(function (h) { return typeKey_(h) === typeKey_(a); })) have.push(a); });
    cell.setValue(asText_(have.join(', ')));
  });
}

/**
 * Buat sheet Daftar Mesin kalau belum ada, diisi semua nama Machine (C) dua bahasa yang sudah dipakai
 * (satu baris per nama English, ejaan Mandarin yang paling sering dipakai, nama ③ asli dari catatan sel
 * sebagai nama di laporan). Tinggal dirapikan: hapus yang salah, perbaiki Mandarinnya.
 */
function openMachineList() {
  var ss = ss_();
  var sh = ss.getSheetByName(MACHINE_SHEET);
  var created = false;
  if (!sh) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Masih ada proses lain yang berjalan. Coba lagi beberapa detik.');
    try {
      var byKey = {};
      var order = [];
      issueSheetNames_(ss).forEach(function (name) {
        var s = ss.getSheetByName(name);
        var last = s.getLastRow();
        if (last < ROW.DATA_START) return;
        var range = s.getRange(ROW.DATA_START, COL.MACHINE, last - ROW.DATA_START + 1, 1);
        var notes = range.getNotes();
        range.getDisplayValues().forEach(function (v, i) {
          var c = String(v[0]).trim();
          var j = c.indexOf('\n(');
          if (j === -1 || !/\)$/.test(c)) return;
          var zh = c.slice(0, j).trim(), en = c.slice(j + 2, -1).trim();
          var k = typeKey_(en);
          if (!zh || !k) return;
          if (!byKey[k]) { byKey[k] = { en: en, zh: {}, alias: [], n: 0 }; order.push(k); }
          var e = byKey[k];
          e.n++;
          e.zh[zh] = (e.zh[zh] || 0) + 1;
          var sm = splitMachine_(originalFromNote_(notes[i][0]) || '');
          if (sm && typeKey_(sm.process) !== k && e.alias.indexOf(sm.process) === -1) e.alias.push(sm.process);
        });
      });
      var rows = order.map(function (k) { return byKey[k]; }).sort(function (a, b) { return b.n - a.n; }).map(function (e) {
        var zh = Object.keys(e.zh).sort(function (a, b) { return e.zh[b] - e.zh[a]; })[0];
        return [asText_(zh), asText_(e.en), '', asText_(e.alias.join(', '))];
      });
      sh = ss.insertSheet(MACHINE_SHEET, ss.getSheets().length);
      sh.getRange(1, 1, 1, MACHINE_HEADERS.length).setValues([MACHINE_HEADERS]).setFontWeight('bold').setBackground('#C6D9F1');
      sh.getRange(1, 1).setNote('Satu mesin/line per baris. Kolom Machine (C) ditulis "中文" lalu "(English)" persis seperti di ' +
        'sini. Proyek: kosong = semua proyek, atau kode seperti DJ2518. Kolom D: nama yang ditulis operator di ③ ' +
        '(pisahkan koma); nama yang Anda pilih manual di layar Periksa otomatis ditambahkan ke sini.');
      if (rows.length) sh.getRange(2, 1, rows.length, MACHINE_HEADERS.length).setValues(rows);
      sh.setFrozenRows(1);
      [[1, 220], [2, 260], [3, 170], [4, 320]].forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
      created = true;
    } finally {
      lock.releaseLock();
    }
  }
  return { url: machineListInfo_(ss).url, created: created, count: Math.max(0, sh.getLastRow() - 1), machines: machineOptions_(machineList_(ss)) };
}

/** Nama pelapor yang pernah ditulis tool (dari K / catatan sel K), paling sering dulu. */
function reporterRoster_(ss) {
  var names = nameCounter_();
  issueSheetNames_(ss).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var last = sh.getLastRow();
    if (last < ROW.DATA_START) return;
    var range = sh.getRange(ROW.DATA_START, COL.NOTES, last - ROW.DATA_START + 1, 1);
    var notes = range.getNotes();
    range.getDisplayValues().forEach(function (r, i) {
      var n = parseNotesInfo_(r[0], notes[i][0]).reporter;
      if (n) names.add(n, 1, 1);
    });
  });
  return names.list();
}

/** Penghitung nama: huruf besar/kecil digabung, ejaan yang paling sering menang; urut paling sering. */
function nameCounter_() {
  var count = {};
  var forms = {};
  var add = function (name, weight, used) {
    var k = name.toLowerCase();
    if (!forms[k]) { forms[k] = {}; count[k] = 0; }
    forms[k][name] = (forms[k][name] || 0) + weight;
    count[k] += used;
  };
  var list = function () { return Object.keys(forms).map(function (k) {
    var best = Object.keys(forms[k]).sort(function (a, b) { return forms[k][b] - forms[k][a]; })[0];
    return { name: best, count: count[k] };
  }).sort(function (a, b) { return b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }); };
  return { add: add, list: list };
}

// ---------- Rute proyek ----------

// Kode proyek untuk sheet yang dibuat lewat menu "Buat sheet baru" disimpan sebagai developer
// metadata di sheet itu sendiri: ikut walau sheet di-rename, hilang kalau sheet dihapus.
var ROUTE_META_KEY = 'wechatImport.projectCode';

/**
 * Kode proyek (huruf besar, tanpa spasi/strip) -> nama sheet. PROJECT_SHEET di Config menang,
 * kecuali sheet-nya tidak ada dan kode itu sudah punya sheet dari menu "Buat sheet baru"
 * (mis. spreadsheet baru yang tidak punya "Geely list (2)").
 */
function projectRoutes_(ss) {
  var out = {};
  ss.getSheets().forEach(function (sh) {
    sh.getDeveloperMetadata().forEach(function (m) {
      var code = projectKey_(m.getValue());
      if (m.getKey() === ROUTE_META_KEY && code && !out.hasOwnProperty(code)) out[code] = sh.getName();
    });
  });
  Object.keys(PROJECT_SHEET).forEach(function (k) {
    var code = projectKey_(k);
    if (ss.getSheetByName(PROJECT_SHEET[k]) || !out.hasOwnProperty(code)) out[code] = PROJECT_SHEET[k];
  });
  return out;
}

/** Sheet tujuan yang sudah dicek, atau error yang jelas (tidak pernah menulis ke sheet yang salah). */
function issueSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    throw new Error('Sheet "' + name + '" tidak ditemukan. Cek nama sheet atau PROJECT_SHEET di Config.gs.');
  }
  if (!isIssueSheet_(sh)) {
    throw new Error('Sheet "' + name + '" bukan sheet issue (header baris ' + ROW.HEADER + ' tidak cocok). Data tidak ditulis.');
  }
  return sh;
}

// ---------- Baris tujuan ----------

function isEmpty_(v) {
  return v === '' || v === null || v === undefined || String(v).trim() === '';
}

/** Baris pertama (mulai `fromRow`) yang kolom C dan D-nya kosong. */
function findNextRow(sh, fromRow) {
  var start = Math.max(fromRow || ROW.DATA_START, ROW.DATA_START);
  var last = sh.getLastRow();
  if (last >= start) {
    var cd = sh.getRange(start, COL.MACHINE, last - start + 1, 2).getValues();
    for (var i = 0; i < cd.length; i++) {
      if (isEmpty_(cd[i][0]) && isEmpty_(cd[i][1])) return start + i;
    }
  }
  return Math.max(last + 1, start);
}

/**
 * Siapkan baris `row` sebelum ditulis:
 * - Sheet Google punya jumlah baris tetap (mis. 1.000). Kalau `row` di luar itu, baris ditambah dulu
 *   (tanpa ini Google menolak: "coordinates ... outside the dimensions of the sheet").
 * - Tabel template/manajer hanya berbingkai + ber-dropdown H sampai baris 35. Baris di bawahnya
 *   menyalin format & dropdown baris di atasnya, jadi tabel ikut memanjang seiring data bertambah.
 */
function prepareRow_(sh, row) {
  var max = sh.getMaxRows();
  if (row > max) sh.insertRowsAfter(max, Math.max(row - max, 50));
  if (row <= ROW.DATA_START) return;
  if (sh.getRange(row, COL.DISCIPLINE).getDataValidation() || !sh.getRange(row - 1, COL.DISCIPLINE).getDataValidation()) return;
  var width = COL.NOTES - COL.NO + 1;
  var src = sh.getRange(row - 1, COL.NO, 1, width);
  var dst = sh.getRange(row, COL.NO, 1, width);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
}

/** Nomor urut lanjutan = angka terbesar di kolom B di atas `row` + 1. */
function nextNumber_(sh, row) {
  var n = row - ROW.DATA_START;
  if (n <= 0) return 1;
  var max = 0;
  sh.getRange(ROW.DATA_START, COL.NO, n, 1).getValues().forEach(function (r) {
    var v = Number(r[0]);
    if (!isEmpty_(r[0]) && isFinite(v) && v > max) max = v;
  });
  return max + 1;
}

function colLetter_(n) {
  return String.fromCharCode(64 + n);
}

/**
 * Teks yang diawali = + - @ dianggap rumus oleh Sheets ("- lem habis" -> #ERROR!), dan teks yang
 * mirip angka/tanggal diubah jadi angka. Awalan ' memaksa teks (tidak terlihat di sel).
 */
function asText_(v) {
  var s = String(v == null ? '' : v);
  return s && (/^[=+\-@]/.test(s) || /^[\d\s.,:\/\-]+$/.test(s)) ? "'" + s : s;
}

/**
 * Tulis satu record ke baris `row`.
 * - B hanya diisi kalau masih kosong (nomor yang sudah ada tidak diubah).
 * - E & F (Root Cause, Solution) tidak pernah diisi. Tidak ada sel yang diwarnai; latar C:K
 *   dikembalikan polos (sisa warna dari impor lama ikut hilang).
 * - Catatan sel C, D, K diisi teks asli + peringatan (kalau diterjemahkan), selain itu dikosongkan.
 * - G dan J ditulis sebagai nomor seri + format sel, bukan objek Date,
 *   jadi hasilnya tidak bergeser walau timezone script ≠ timezone spreadsheet.
 * - `override` (dari "✎ Edit" di layar Periksa, lihat Edit.gs) menggantikan nilai/catatan hasil parser;
 *   E/F hanya ditulis kalau ada di override.
 * Mengembalikan nilai akhir yang ditulis (sebelum awalan ').
 */
function writeRecord(sh, row, rec, override) {
  prepareRow_(sh, row);
  var out = buildRow_(rec);
  if (override) {
    Object.keys(override.values).forEach(function (k) { out.values[k] = override.values[k]; });
    Object.keys(override.notes).forEach(function (k) { out.notes[k] = override.notes[k]; });
  }
  var finalValues = {};
  Object.keys(out.values).forEach(function (k) { finalValues[k] = out.values[k]; });
  ['MACHINE', 'DESC', 'ROOT_CAUSE', 'SOLUTION', 'PIC', 'NOTES'].forEach(function (k) {
    if (out.values.hasOwnProperty(k)) out.values[k] = asText_(out.values[k]);
  });
  var noCell = sh.getRange(row, COL.NO);
  var no = noCell.getValue();
  if (isEmpty_(no)) {
    no = nextNumber_(sh, row);
    noCell.setValue(no);
  }
  // Satu panggilan setValues per kelompok kolom yang bersebelahan (C:D dan G:K, atau C:K kalau E/F diisi).
  var cols = Object.keys(out.values).map(function (k) { return { col: COL[k], value: out.values[k] }; })
    .sort(function (a, b) { return a.col - b.col; });
  var run = [];
  cols.forEach(function (c, i) {
    run.push(c);
    if (i === cols.length - 1 || cols[i + 1].col !== c.col + 1) {
      sh.getRange(row, run[0].col, 1, run.length).setValues([run.map(function (x) { return x.value; })]);
      run = [];
    }
  });
  setCellFormat_(sh, row, COL.END_TIME, FORMAT.END_TIME);
  setCellFormat_(sh, row, COL.DATE, FORMAT.DATE);
  var notes = [];
  for (var c = COL.MACHINE; c <= COL.NOTES; c++) notes.push('');
  Object.keys(out.notes).forEach(function (k) { notes[COL[k] - COL.MACHINE] = out.notes[k]; });
  sh.getRange(row, COL.MACHINE, 1, notes.length).setNotes([notes]).setBackground(null);
  return { row: row, no: no, values: finalValues };
}

// Kolom (sheetId:kolom) yang menolak setNumberFormat selama proses ini, supaya tidak dicoba berulang.
var FIXED_FORMAT_COLS_ = {};

/**
 * Format jam (G) / tanggal (J) satu sel, hanya kalau formatnya belum sama.
 * Kolom ber-tipe di "Table" Google Sheets (mis. End Time = Time, Date = Date) menolak setNumberFormat
 * ("You can't set the number format of cells in a typed column"): formatnya sudah diatur Table, jadi dilewati.
 * Google melaporkan penolakan itu terlambat (di baca/tulis berikutnya), maka di-flush di sini supaya tidak
 * menggagalkan laporan berikutnya.
 */
function setCellFormat_(sh, row, col, format) {
  var key = sh.getSheetId() + ':' + col;
  if (FIXED_FORMAT_COLS_[key]) return;
  var cell = sh.getRange(row, col);
  if (cell.getNumberFormat && cell.getNumberFormat() === format) return;
  try {
    cell.setNumberFormat(format);
    SpreadsheetApp.flush();
  } catch (e) {
    if (!/typed column|number format/i.test(String(e.message || e))) throw e;
    FIXED_FORMAT_COLS_[key] = true;
  }
}

/**
 * Isi dropdown kolom H (dibaca dari validasi sel baris data pertama), atau null kalau tidak ada.
 * Dipakai setup() untuk memastikan DISCIPLINES cocok; nilai di luar dropdown ditolak Sheets.
 */
function dropdownValues_(sh) {
  var rule = sh.getRange(ROW.DATA_START, COL.DISCIPLINE).getDataValidation();
  if (!rule) return null;
  var C = SpreadsheetApp.DataValidationCriteria;
  var type = String(rule.getCriteriaType()); // enum dibandingkan lewat namanya
  var arg = rule.getCriteriaValues()[0];
  var vals;
  if (type === String(C.VALUE_IN_LIST)) vals = arg;
  else if (type === String(C.VALUE_IN_RANGE)) vals = [].concat.apply([], arg.getDisplayValues());
  else return null;
  return vals.map(function (v) { return String(v).trim(); }).filter(function (v) { return v !== ''; });
}

// ---------- Duplikat ----------

/**
 * Kunci (Machine|Deskripsi|End Time|Date seperti tampil di sheet) -> nomor baris.
 * Untuk C/D yang sudah diterjemahkan, dipakai teks asli dari catatan sel ("Asli (ID): …").
 */
/**
 * Tanggal J sebagai "yyyy/mm/dd" apa pun format tampilannya. Sel tanggal asli (mis. tampil "11/1/2026"
 * di spreadsheet ber-locale US) dibaca dari nilainya, bukan ditebak dari teksnya; angka seri lama lewat
 * normDate_; selain itu apa adanya. `shown` = nilai tampilan kolom J untuk baris yang sama.
 */
function dateTexts_(sh, from, n, shown) {
  var tz = ss_().getSpreadsheetTimeZone();
  return sh.getRange(from, COL.DATE, n, 1).getValues().map(function (r, i) {
    var v = r[0];
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy/MM/dd');
    return normDate_(shown[i]);
  });
}

function existingKeys_(sh) {
  var keys = {};
  var last = sh.getLastRow();
  if (last < ROW.DATA_START) return keys;
  var first = Math.min(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE);
  var width = Math.max(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE) - first + 1;
  var n = last - ROW.DATA_START + 1;
  var range = sh.getRange(ROW.DATA_START, first, n, width);
  var vals = range.getDisplayValues();
  var notes = range.getNotes();
  var dates = dateTexts_(sh, ROW.DATA_START, n, vals.map(function (v) { return v[COL.DATE - first]; }));
  vals.forEach(function (v, i) {
    var c = v[COL.MACHINE - first], d = v[COL.DESC - first];
    if (isEmpty_(c) && isEmpty_(d)) return;
    var orig = function (col, shown) { return originalFromNote_(notes[i][col - first]) || shown; };
    var key = recordKey_(orig(COL.MACHINE, c), orig(COL.DESC, d), v[COL.END_TIME - first], dates[i]);
    if (!keys.hasOwnProperty(key)) keys[key] = ROW.DATA_START + i;
  });
  return keys;
}

// ---------- API untuk UI ----------

/**
 * Pratinjau tanpa menulis apa pun. `include` = default centang di UI:
 * tidak dicentang kalau jenisnya di SKIP_TYPES, duplikat, atau tidak bisa ditulis.
 * opts.translate === false: tanpa terjemahan. Kalau terjemahan gagal, record tetap tampil
 * (tanpa terjemahan) dan `translateError` diisi; UI menawarkan lanjut tanpa terjemahan.
 */
function previewWeChat(text, otherSheet, opts) {
  var ss = ss_();
  var other = issueSheet_(ss, otherSheet).getName();
  var recs = parseReports(text);
  var routes = projectRoutes_(ss);
  var deleted = deletedKeys_(ss);
  applyPicList_(recs, picList_(ss));
  applyMachineList_(recs, machineList_(ss));
  var info = {};
  recs.forEach(function (r) {
    if (deleted.hasOwnProperty(r.key)) r.deletedBefore = deleted[r.key];
    var name = targetSheetName_(r, other, routes);
    if (!info[name]) info[name] = sheetInfo_(ss, name);
    r.sheet = name;
    r.sheetError = info[name].error;
    if (!r.duplicateOf && info[name].keys.hasOwnProperty(r.key)) {
      r.duplicateOf = { where: 'sheet', sheet: name, row: info[name].keys[r.key] };
    }
  });
  var translateError = '';
  if (wantTranslate_(opts)) {
    try {
      translateRecords_(recs.filter(function (r) { return r.writable; }));
    } catch (e) {
      translateError = 'Terjemahan gagal: ' + (e.message || e);
    }
  }
  return {
    translated: wantTranslate_(opts) && !translateError,
    translateError: translateError,
    records: recs.map(toView_),
    sheets: Object.keys(info).map(function (n) {
      return { name: n, nextRow: info[n].nextRow, error: info[n].error };
    })
  };
}

function sheetInfo_(ss, name) {
  var sh;
  try {
    sh = issueSheet_(ss, name);
  } catch (e) {
    return { error: e.message, nextRow: null, keys: {} };
  }
  return { error: '', nextRow: findNextRow(sh), keys: existingKeys_(sh) };
}

/** Ringkasan baris yang sudah ditulis (dengan isian yang diedit) untuk halaman Selesai & teks mentor. */
function writtenView_(rec, it, v) {
  var view = toView_(rec);
  var cells = it.cells;
  var typed = function (k) {
    var s = cleanLines_(String(cells[k] || '')).join('\n');
    return cells.hasOwnProperty(k) && s && !hasChinese_(s) ? s : '';
  };
  view.cells = { C: v.MACHINE, D: v.DESC, K: v.NOTES };
  view.pic = v.PIC;
  view.machine = typed('MACHINE') || view.machine;
  view.description = typed('DESC') || view.description;
  if (cells.hasOwnProperty('END_TIME')) view.end = v.END_TIME === '' ? '' : fmtTime_(parseEditTime_(cells.END_TIME));
  if (cells.hasOwnProperty('DATE')) view.date = v.DATE === '' ? '' : fmtDate_(parseEditDate_(cells.DATE));
  view.empty = ['ROOT_CAUSE', 'SOLUTION', 'MACHINE', 'DESC', 'END_TIME', 'DISCIPLINE', 'PIC', 'DATE']
    .filter(function (k) { return v[k] === '' || v[k] === undefined || v[k] === null; })
    .map(function (k) { return { key: k, col: colLetter_(COL[k]) }; });
  return view;
}

/** Record -> objek polos untuk UI (label sudah diformat, `cells` = isi sel yang akan ditulis). */
function toView_(r) {
  var row = buildRow_(r);
  return {
    id: r.id,
    sheet: r.sheet || '',
    sheetError: r.sheetError || '',
    date: fmtDate_(r.start.date),
    start: fmtTime_(r.start.time),
    end: fmtTime_(r.end.time),
    endDate: (r.start.date && r.end.date && fmtDate_(r.start.date) !== fmtDate_(r.end.date)) ? fmtDate_(r.end.date) : '',
    duration: r.duration,
    durationText: durationText_(r),
    level: r.level,
    project: r.project,
    process: r.process,
    machine: r.machine,
    description: r.description,
    type: r.type,
    discipline: r.discipline,
    pic: r.pic,
    reporter: r.reporter || '',
    lineStatus: r.lineStatus,
    handling: r.handling,
    skip: r.skip,
    writable: r.writable,
    duplicateOf: r.duplicateOf || null,
    deletedBefore: r.deletedBefore || null, // pernah dihapus lewat tool (WeChat_Deleted)
    machineRow: r.machineEntry ? r.machineEntry.row : null, // baris Daftar Mesin yang dipakai untuk C
    translated: !!r.tr,
    // K tanpa pelapor: UI menambahkan pelapor yang dipilih dengan aturan yang sama (withReporter_).
    cells: { C: row.values.MACHINE, D: row.values.DESC, K: row.notesBase },
    empty: row.empty.map(function (k) { return { key: k, col: colLetter_(COL[k]) }; }),
    warnings: r.warnings.map(function (w) { return { col: w.col ? colLetter_(COL[w.col]) : '', msg: w.msg }; }),
    include: r.writable && !r.sheetError && !r.skip && !r.duplicateOf && !r.deletedBefore
  };
}

/**
 * Tulis laporan yang dipilih. Teks di-parse ulang di server (sumber kebenaran tetap teks
 * aslinya); `picks` = [{ id, discipline }] dari pratinjau. Ditulis urut jam kejadian.
 * Terjemahan dikerjakan SEBELUM menulis: kalau gagal, tidak ada satu baris pun yang ditulis.
 */
function importWeChat(text, otherSheet, picks, opts) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('Masih ada impor lain yang berjalan. Coba lagi beberapa detik.');
  }
  try {
    var ss = ss_();
    var other = issueSheet_(ss, otherSheet).getName();
    var routes = projectRoutes_(ss);
    var chosen = {};
    (picks || []).forEach(function (p) { chosen[p.id] = p; });
    var nextFrom = {};
    var written = [];
    var errors = [];
    var mlist = machineList_(ss);
    var learns = [];
    var recs = applyMachineList_(applyPicList_(parseReports(text), picList_(ss)), mlist)
      .filter(function (rec) { return chosen.hasOwnProperty(rec.id); });
    recs.forEach(function (rec) {
      applyDisciplineChoice_(rec, chosen[rec.id].discipline);
      // Pelapor yang dipilih/diubah di pratinjau (nama apa adanya, tidak diterjemahkan).
      if (chosen[rec.id].reporter != null) rec.reporter = String(chosen[rec.id].reporter).replace(/\s+/g, ' ').trim().slice(0, 60);
      // Mesin/line yang dipilih dari Daftar Mesin (nomor baris di sheet itu).
      var mp = chosen[rec.id].machine;
      var entry = mp != null && mp !== '' && mlist ? mlist.filter(function (m) { return m.row === Number(mp); })[0] : null;
      if (entry) {
        rec.machineEntry = entry;
        rec.warnings = rec.warnings.filter(function (w) { return !/belum ada di Daftar Mesin/.test(w.msg); });
        learns.push({ id: rec.id, entry: entry, alias: rec.process });
      }
    });
    // Terjemahan hasil parser + isian yang diedit, semuanya SEBELUM menulis.
    var items = recs.filter(function (r) { return r.writable; })
      .map(function (r) { return { rec: r, cells: chosen[r.id].cells || {} }; });
    var edited = {};
    try {
      if (wantTranslate_(opts)) translateRecords_(items.map(function (it) { return it.rec; }));
      prepareEdits_(items, wantTranslate_(opts));
      items.forEach(function (it) { if (!it.error) applyTimeEdits_(it.rec, it.cells); });
    } catch (e) {
      throw new Error('Terjemahan gagal, tidak ada yang ditulis: ' + (e.message || e) + '. Coba lagi, atau lanjut tanpa terjemahan.');
    }
    items.forEach(function (it) { edited[it.rec.id] = it; });
    recs.forEach(function (rec) {
      var label = (fmtTime_(rec.start.time) || '??:??') + ' ' + (rec.machine || rec.description);
      if (!rec.writable) {
        errors.push(label + ': Machine & Deskripsi kosong, tidak ditulis.');
        return;
      }
      var it = edited[rec.id];
      if (it.error) {
        errors.push(label + ': ' + it.error + '. Tidak ditulis.');
        return;
      }
      var name = targetSheetName_(rec, other, routes);
      var sh;
      try {
        sh = issueSheet_(ss, name);
      } catch (e) {
        errors.push(label + ': ' + e.message);
        return;
      }
      var row = findNextRow(sh, nextFrom[name]);
      var res;
      try {
        res = writeRecord(sh, row, rec, it.override);
        SpreadsheetApp.flush(); // kesalahan dari Google muncul di laporan ini, bukan di laporan berikutnya
      } catch (e) {
        nextFrom[name] = row + 1;
        errors.push(label + ': ' + (e.message || e) + ' Baris ' + row + ' di "' + name + '" mungkin terisi sebagian, cek dulu.');
        return;
      }
      nextFrom[name] = row + 1;
      var view = writtenView_(rec, it, res.values);
      view.sheet = name;
      view.sheetId = sh.getSheetId();
      view.row = row;
      view.no = res.no;
      written.push(view);
    });
    var done = {};
    written.forEach(function (w) { done[w.id] = true; });
    learnMachineAliases_(ss, learns.filter(function (l) { return done[l.id]; }));
    SpreadsheetApp.flush();
    return { written: written, errors: errors, url: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}
