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
 * Tulis satu record ke baris `row`.
 * - B hanya diisi kalau masih kosong (nomor yang sudah ada tidak diubah).
 * - E & F (Root Cause, Solution) tidak pernah diisi, hanya diberi latar kuning.
 * - G dan J ditulis sebagai nomor seri + format sel, bukan objek Date,
 *   jadi hasilnya tidak bergeser walau timezone script ≠ timezone spreadsheet.
 */
function writeRecord(sh, row, rec) {
  var out = buildRow_(rec);
  var noCell = sh.getRange(row, COL.NO);
  var no = noCell.getValue();
  if (isEmpty_(no)) {
    no = nextNumber_(sh, row);
    noCell.setValue(no);
  }
  // Satu panggilan setValues per kelompok kolom yang bersebelahan (C:D dan G:K).
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
  sh.getRangeList(out.yellow.map(function (k) { return colLetter_(COL[k]) + row; })).setBackground(COLOR.YELLOW);
  return { row: row, no: no };
}

// ---------- Duplikat ----------

/** Kunci (Machine|Deskripsi|End Time|Date seperti tampil di sheet) -> nomor baris. */
function existingKeys_(sh) {
  var keys = {};
  var last = sh.getLastRow();
  if (last < ROW.DATA_START) return keys;
  var first = Math.min(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE);
  var width = Math.max(COL.MACHINE, COL.DESC, COL.END_TIME, COL.DATE) - first + 1;
  var vals = sh.getRange(ROW.DATA_START, first, last - ROW.DATA_START + 1, width).getDisplayValues();
  vals.forEach(function (v, i) {
    var c = v[COL.MACHINE - first], d = v[COL.DESC - first];
    if (isEmpty_(c) && isEmpty_(d)) return;
    var key = recordKey_(c, d, v[COL.END_TIME - first], v[COL.DATE - first]);
    if (!keys.hasOwnProperty(key)) keys[key] = ROW.DATA_START + i;
  });
  return keys;
}

// ---------- API untuk UI ----------

/**
 * Pratinjau tanpa menulis apa pun. `include` = default centang di UI:
 * tidak dicentang kalau jenisnya di SKIP_TYPES, duplikat, atau tidak bisa ditulis.
 */
function previewWeChat(text, otherSheet) {
  var ss = ss_();
  var other = issueSheet_(ss, otherSheet).getName();
  var recs = parseReports(text);
  var info = {};
  recs.forEach(function (r) {
    var name = targetSheetName_(r, other);
    if (!info[name]) info[name] = sheetInfo_(ss, name);
    r.sheet = name;
    r.sheetError = info[name].error;
    if (!r.duplicateOf && info[name].keys.hasOwnProperty(r.key)) {
      r.duplicateOf = { where: 'sheet', sheet: name, row: info[name].keys[r.key] };
    }
  });
  return {
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

/** Record -> objek polos untuk UI (label sudah diformat). */
function toView_(r) {
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
    yellow: buildRow_(r).yellow.map(function (k) { return { key: k, col: colLetter_(COL[k]) }; }),
    warnings: r.warnings.map(function (w) { return { col: w.col ? colLetter_(COL[w.col]) : '', msg: w.msg }; }),
    include: r.writable && !r.sheetError && !r.skip && !r.duplicateOf
  };
}

/**
 * Tulis laporan yang dipilih. Teks di-parse ulang di server (sumber kebenaran tetap teks
 * aslinya); `picks` = [{ id, discipline }] dari pratinjau. Ditulis urut jam kejadian.
 */
function importWeChat(text, otherSheet, picks) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('Masih ada impor lain yang berjalan. Coba lagi beberapa detik.');
  }
  try {
    var ss = ss_();
    var other = issueSheet_(ss, otherSheet).getName();
    var chosen = {};
    (picks || []).forEach(function (p) { chosen[p.id] = p; });
    var nextFrom = {};
    var written = [];
    var errors = [];
    parseReports(text).forEach(function (rec) {
      var p = chosen[rec.id];
      if (!p) return;
      applyDisciplineChoice_(rec, p.discipline);
      var label = (fmtTime_(rec.start.time) || '??:??') + ' ' + (rec.machine || rec.description);
      if (!rec.writable) {
        errors.push(label + ': Machine & Deskripsi kosong, tidak ditulis.');
        return;
      }
      var name = targetSheetName_(rec, other);
      var sh;
      try {
        sh = issueSheet_(ss, name);
      } catch (e) {
        errors.push(label + ': ' + e.message);
        return;
      }
      var row = findNextRow(sh, nextFrom[name]);
      var res = writeRecord(sh, row, rec);
      nextFrom[name] = row + 1;
      var view = toView_(rec);
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
