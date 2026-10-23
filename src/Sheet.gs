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
  sh.getRange(row, COL.END_TIME).setNumberFormat(FORMAT.END_TIME);
  sh.getRange(row, COL.DATE).setNumberFormat(FORMAT.DATE);
  var notes = [];
  for (var c = COL.MACHINE; c <= COL.NOTES; c++) notes.push('');
  Object.keys(out.notes).forEach(function (k) { notes[COL[k] - COL.MACHINE] = out.notes[k]; });
  sh.getRange(row, COL.MACHINE, 1, notes.length).setNotes([notes]).setBackground(null);
  return { row: row, no: no, values: finalValues };
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
function existingKeys_(sh) {
  var keys = {};
  var last = sh.getLastRow();
  if (last < ROW.DATA_START) return keys;
  var first = Math.min(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE);
  var width = Math.max(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE) - first + 1;
  var range = sh.getRange(ROW.DATA_START, first, last - ROW.DATA_START + 1, width);
  var vals = range.getDisplayValues();
  var notes = range.getNotes();
  vals.forEach(function (v, i) {
    var c = v[COL.MACHINE - first], d = v[COL.DESC - first];
    if (isEmpty_(c) && isEmpty_(d)) return;
    var orig = function (col, shown) { return originalFromNote_(notes[i][col - first]) || shown; };
    var key = recordKey_(orig(COL.MACHINE, c), orig(COL.DESC, d), v[COL.END_TIME - first], v[COL.DATE - first]);
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
  var info = {};
  recs.forEach(function (r) {
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
    machine: r.machine,
    description: r.description,
    type: r.type,
    discipline: r.discipline,
    pic: r.pic,
    lineStatus: r.lineStatus,
    handling: r.handling,
    skip: r.skip,
    writable: r.writable,
    duplicateOf: r.duplicateOf || null,
    translated: !!r.tr,
    cells: { C: row.values.MACHINE, D: row.values.DESC, K: row.values.NOTES },
    empty: row.empty.map(function (k) { return { key: k, col: colLetter_(COL[k]) }; }),
    warnings: r.warnings.map(function (w) { return { col: w.col ? colLetter_(COL[w.col]) : '', msg: w.msg }; }),
    include: r.writable && !r.sheetError && !r.skip && !r.duplicateOf
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
    var recs = parseReports(text).filter(function (rec) { return chosen.hasOwnProperty(rec.id); });
    recs.forEach(function (rec) { applyDisciplineChoice_(rec, chosen[rec.id].discipline); });
    // Terjemahan hasil parser + isian yang diedit, semuanya SEBELUM menulis.
    var items = recs.filter(function (r) { return r.writable; })
      .map(function (r) { return { rec: r, cells: chosen[r.id].cells || {} }; });
    var edited = {};
    try {
      if (wantTranslate_(opts)) translateRecords_(items.map(function (it) { return it.rec; }));
      prepareEdits_(items, wantTranslate_(opts));
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
      var res = writeRecord(sh, row, rec, it.override);
      nextFrom[name] = row + 1;
      var view = writtenView_(rec, it, res.values);
      view.sheet = name;
      view.sheetId = sh.getSheetId();
      view.row = row;
      view.no = res.no;
      written.push(view);
    });
    SpreadsheetApp.flush();
    return { written: written, errors: errors, url: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}
