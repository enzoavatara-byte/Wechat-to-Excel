/**
 * Tab "Lengkapi" di web app: isi Root Cause (E), Solution (F), dan Discipline (H) yang masih kosong
 * tanpa membuka sheet. Teks Bahasa Indonesia langsung diterjemahkan ke "中文\n(English)" saat disimpan
 * (teks asli ke catatan sel), jadi menu "Terjemahkan sel terpilih" tidak perlu dipakai.
 */
var COMPLETE_LIMIT = 150;

function hasChinese_(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''));
}

/**
 * Tanggal J seperti tampil. Baris lama manajer menyimpan nomor seri berformat General (tampil "46313"),
 * diubah ke yyyy/mm/dd supaya terbaca dan bisa diurutkan bersama baris dari tool.
 */
function normDate_(shown) {
  var s = String(shown || '').trim();
  if (!/^\d{5}$/.test(s)) return s;
  var d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
  return fmtDate_({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

/**
 * Jam mulai, downtime, jenis, status & pelapor dari kolom K (Notes) yang ditulis tool, dalam format apa pun:
 * "开始：18:05；影响时长：18分钟…\n(…Start: 18:05; Downtime: 18 min; …)" atau "Mulai: 18:05 | Durasi: 18 menit | …".
 * Teks Bahasa Indonesia dari catatan sel K ("Asli (ID): … | Lini: Mesin pulih | …") didahulukan karena
 * lebih mudah dibaca. Notes buatan manajer (teks bebas) -> semua kosong.
 */
function parseNotesInfo_(k, note) {
  var s = String(k || '');
  var n = String(note || '');
  var pick = function (src, re) {
    var m = re.exec(src);
    var v = m ? m[1].trim() : '';
    return v === '-' ? '' : v;
  };
  var first = function (re1, re2, re3) { return pick(n, re1) || pick(s, re2) || (re3 ? pick(s, re3) : ''); };
  var down = pick(s, /(?:Downtime|Durasi)\s*:\s*(\d+)\s*(?:min|menit)/) || pick(s, /影响时长：\s*(\d+)\s*分钟/);
  return {
    start: pick(s, /(?:Start|Mulai)\s*:\s*(\d{1,2}:\d{2})/) || pick(s, /开始：\s*(\d{1,2}:\d{2})/),
    downtime: down ? Number(down) : null,
    unverified: /unverified|belum diverifikasi|未核实/.test(s),
    type: first(/Jenis:\s*([^|\n]+)/, /Jenis:\s*([^|\n]+)/, /Type:\s*([^;)\n]+)/),
    lineStatus: first(/Lini:\s*([^|\n]+)/, /Lini:\s*([^|\n]+)/, /Line status:\s*([^;)\n]+)/),
    handling: first(/Penanganan:\s*([^|\n]+)/, /Penanganan:\s*([^|\n]+)/, /Handling:\s*([^;)\n]+)/),
    reporter: pick(n, /Pelapor:\s*([^|\n]+)/) || pick(s, /(?:Pelapor|Reporter):\s*([^|;)\n]+)/) || pick(s, /报告人：\s*([^；\n]+)/)
  };
}

function minutesOf_(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}

/** Downtime dari jam mulai & jam selesai (G) kalau bisa (G yang diedit tetap benar), selain itu dari K. */
function rowDowntime_(start, end, fromNotes) {
  var a = minutesOf_(start), b = minutesOf_(end);
  return a !== null && b !== null && b >= a ? b - a : fromNotes;
}

/** Satu baris sheet sebagai objek untuk UI. `cur` = nilai tampilan B:K, `notes` = catatan B:K. */
function completeRow_(name, sheetId, row, cur, notes) {
  var get = function (k) { return cur[COL[k] - COL.NO]; };
  var note = function (k) { return notes[COL[k] - COL.NO]; };
  // E/F perlu dikerjakan kalau kosong, atau berisi teks Indonesia yang belum diterjemahkan.
  // "-" / "-\n(-)" = sengaja tidak ada (mis. masalah operasi) -> dianggap terisi.
  var todo = function (k) { var v = get(k); return isEmpty_(v) || (!hasChinese_(v) && !/^[\s\-\u2013\u2014()\/.]+$/.test(v)); };
  var need = ['ROOT_CAUSE', 'SOLUTION'].filter(todo);
  if (isEmpty_(get('DISCIPLINE'))) need.push('DISCIPLINE');
  var info = parseNotesInfo_(get('NOTES'), note('NOTES'));
  var machineSrc = splitMachine_(originalFromNote_(note('MACHINE')) || get('MACHINE'));
  return {
    sheet: name,
    sheetId: sheetId,
    row: row,
    no: get('NO'),
    machine: get('MACHINE'),
    machineOrig: originalFromNote_(note('MACHINE')) || '',
    description: get('DESC'),
    descOrig: originalFromNote_(note('DESC')) || '',
    rootCause: get('ROOT_CAUSE'),
    solution: get('SOLUTION'),
    pic: get('PIC'),
    discipline: get('DISCIPLINE'),
    end: get('END_TIME'),
    date: normDate_(get('DATE')),
    start: info.start,
    downtime: rowDowntime_(info.start, get('END_TIME'), info.downtime),
    downtimeUnverified: info.unverified,
    type: info.type,
    lineStatus: info.lineStatus,
    handling: info.handling,
    reporter: info.reporter,
    process: machineSrc ? machineSrc.process : '',
    need: need.map(function (k) { return { key: k, col: colLetter_(COL[k]) }; })
  };
}

/** Nilai tampilan B:K (tanggal J sudah dinormalkan ke yyyy/mm/dd, lihat dateTexts_) + catatan sel B:K. */
function readRows_(sh, from, n) {
  var range = sh.getRange(from, COL.NO, n, COL.NOTES - COL.NO + 1);
  var vals = range.getDisplayValues();
  var j = COL.DATE - COL.NO;
  dateTexts_(sh, from, n, vals.map(function (v) { return v[j]; })).forEach(function (d, i) { vals[i][j] = d; });
  return { vals: vals, notes: range.getNotes() };
}

/** Baris (C atau D terisi) yang E/F/H-nya belum lengkap, dari semua sheet issue. Terbaru dulu. */
function listIncomplete() {
  var ss = ss_();
  var rows = [];
  issueSheetNames_(ss).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var last = sh.getLastRow();
    if (last < ROW.DATA_START) return;
    var data = readRows_(sh, ROW.DATA_START, last - ROW.DATA_START + 1);
    data.vals.forEach(function (v, i) {
      if (isEmpty_(v[COL.MACHINE - COL.NO]) && isEmpty_(v[COL.DESC - COL.NO])) return;
      var r = completeRow_(name, sh.getSheetId(), ROW.DATA_START + i, v, data.notes[i]);
      if (r.need.length) rows.push(r);
    });
  });
  rows.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.row - a.row;
  });
  return {
    rows: rows.slice(0, COMPLETE_LIMIT),
    total: rows.length,
    sheets: issueSheetNames_(ss),
    url: ss.getUrl(),
    translate: TRANSLATE,
    disciplines: DISCIPLINES,
    roster: picRoster_(ss)
  };
}

/**
 * Simpan isian satu baris. item = { sheet, row, expect: {machine, description, rootCause, solution,
 * discipline}, rootCause, solution, discipline }. `expect` = isi yang dilihat di UI: kalau baris sudah
 * berubah (mis. bergeser), tidak ada yang ditulis. Isi berbahasa Mandarin tidak pernah ditimpa.
 * Terjemahan dikerjakan sebelum menulis.
 */
function saveCompletion(item) {
  item = item || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Masih ada proses lain yang berjalan. Coba lagi beberapa detik.');
  try {
    var ss = ss_();
    var sh = issueSheet_(ss, item.sheet);
    var row = Number(item.row);
    if (!(row >= ROW.DATA_START) || row !== Math.floor(row)) throw new Error('Nomor baris tidak valid.');
    var data = readRows_(sh, row, 1);
    var cur = completeRow_(sh.getName(), sh.getSheetId(), row, data.vals[0], data.notes[0]);
    var exp = item.expect || {};
    ['machine', 'description', 'rootCause', 'solution', 'discipline', 'pic'].forEach(function (k) {
      if (k === 'pic' && !exp.hasOwnProperty('pic')) return; // PIC hanya dicek kalau UI mengirimnya
      if (String(exp[k] == null ? '' : exp[k]) !== cur[k]) {
        throw new Error('Baris ' + row + ' di "' + cur.sheet + '" sudah berubah sejak daftar dimuat. Klik "Muat ulang".');
      }
    });

    var fields = [];
    [['ROOT_CAUSE', 'rootCause'], ['SOLUTION', 'solution']].forEach(function (f) {
      var text = cleanLines_(String(item[f[1]] || '')).join('\n');
      if (!text || text === cur[f[1]] && hasChinese_(text)) return;
      if (hasChinese_(cur[f[1]])) throw new Error(colLetter_(COL[f[0]]) + row + ' sudah berisi teks Mandarin; tidak ditimpa.');
      fields.push({ key: f[0], text: text });
    });
    var disc = String(item.discipline || '');
    if (disc && disc !== cur.discipline) {
      if (DISCIPLINES.indexOf(disc) === -1) throw new Error('Discipline "' + disc + '" tidak ada di dropdown.');
      if (!isEmpty_(cur.discipline)) throw new Error('H' + row + ' sudah terisi; tidak ditimpa.');
    } else {
      disc = '';
    }
    // PIC dari pemilih: nama apa adanya (tidak diterjemahkan), digabung ", ".
    var pic = item.pic == null ? null : splitPics_(item.pic).join(', ');
    if (pic === cur.pic) pic = null;
    if (!fields.length && !disc && pic === null) throw new Error('Tidak ada yang diisi.');

    // Terjemahkan dulu (kecuali yang sudah ditulis dengan huruf Mandarin), baru tulis.
    var toTranslate = TRANSLATE ? fields.filter(function (f) { return !hasChinese_(f.text); }) : [];
    if (toTranslate.length) {
      var en, zh;
      try {
        en = translateTexts_(toTranslate.map(function (f) { return f.text; }), 'id', 'en');
        zh = translateTexts_(en, 'en', 'zh-CN').map(fixZh_);
      } catch (e) {
        throw new Error('Terjemahan gagal, belum ada yang ditulis: ' + (e.message || e));
      }
      toTranslate.forEach(function (f, k) {
        f.value = bi_(zh[k], en[k]);
        f.note = NOTE_PREFIX + f.text;
      });
    }
    fields.forEach(function (f) {
      if (f.value === undefined) { f.value = f.text; f.note = ''; }
      sh.getRange(row, COL[f.key]).setValue(asText_(f.value)).setNote(f.note);
    });
    if (disc) sh.getRange(row, COL.DISCIPLINE).setValue(disc);
    if (pic !== null) sh.getRange(row, COL.PIC).setValue(asText_(pic));
    SpreadsheetApp.flush();

    var after = readRows_(sh, row, 1);
    return completeRow_(sh.getName(), sh.getSheetId(), row, after.vals[0], after.notes[0]);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Hapus baris (laporan yang tidak seharusnya di-upload) ----------

// Sheet tersembunyi berisi salinan setiap baris yang dihapus lewat tool: jejak untuk manajer, bisa
// disalin balik kalau salah hapus, dan dipakai pratinjau untuk menandai laporan yang pernah dihapus.
var DELETED_SHEET = 'WeChat_Deleted';
var DELETED_HEADERS = ['Dihapus pada', 'Sheet', 'Baris', 'No.', 'Machine', 'Issue Description', 'Root Cause', 'Solution',
  'End Time', 'Discipline', 'Responsibility', 'Date', 'Notes', 'Catatan sel Notes', 'Machine asli', 'Deskripsi asli', 'Kunci duplikat'];

function deletedLog_(ss, create) {
  var sh = ss.getSheetByName(DELETED_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(DELETED_SHEET, ss.getSheets().length);
    sh.getRange(1, 1, 1, DELETED_HEADERS.length).setValues([DELETED_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

/** Kunci duplikat (format existingKeys_) -> { at, sheet } untuk laporan yang pernah dihapus lewat tool. */
function deletedKeys_(ss) {
  var sh = deletedLog_(ss, false);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var n = DELETED_HEADERS.length;
  sh.getRange(2, 1, sh.getLastRow() - 1, n).getDisplayValues().forEach(function (r) {
    if (r[n - 1]) out[r[n - 1]] = { at: r[0], sheet: r[1] };
  });
  return out;
}

/**
 * Hapus satu baris laporan. item = { sheet, row, expect: { machine, description } }: kalau isi baris
 * sudah berubah sejak dimuat (mis. baris bergeser), tidak ada yang dihapus.
 * - Baris dihapus utuh (baris di bawahnya naik), jadi tidak ada lubang yang nanti terisi laporan lain.
 * - No. laporan lain tidak diubah (lihat komentar di bawah).
 * - Salinan baris + kunci duplikatnya disimpan di sheet tersembunyi WeChat_Deleted.
 */
function deleteIssueRow(item) {
  item = item || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Masih ada proses lain yang berjalan. Coba lagi beberapa detik.');
  try {
    var ss = ss_();
    var sh = issueSheet_(ss, item.sheet);
    var row = Number(item.row);
    if (!(row >= ROW.DATA_START) || row !== Math.floor(row) || row > sh.getLastRow()) throw new Error('Nomor baris tidak valid.');
    var data = readRows_(sh, row, 1);
    var v = data.vals[0], n = data.notes[0];
    var cur = completeRow_(sh.getName(), sh.getSheetId(), row, v, n);
    var exp = item.expect || {};
    if (String(exp.machine == null ? '' : exp.machine) !== cur.machine ||
        String(exp.description == null ? '' : exp.description) !== cur.description) {
      throw new Error('Baris ' + row + ' di "' + cur.sheet + '" sudah berubah sejak daftar dimuat. Muat ulang dulu; tidak ada yang dihapus.');
    }
    if (isEmpty_(cur.machine) && isEmpty_(cur.description)) throw new Error('Baris ' + row + ' kosong; tidak ada yang dihapus.');

    var origC = originalFromNote_(n[COL.MACHINE - COL.NO]) || '';
    var origD = originalFromNote_(n[COL.DESC - COL.NO]) || '';
    var key = recordKey_(origC || cur.machine, origD || cur.description, cur.end, cur.date);
    var at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
    var log = deletedLog_(ss, true);
    var to = log.getLastRow() + 1;
    if (to > log.getMaxRows()) log.insertRowsAfter(log.getMaxRows(), 100);
    var copy = [at, sh.getName(), row].concat(v.slice(0, COL.NOTES - COL.NO + 1), [n[COL.NOTES - COL.NO], origC, origD, key]);
    // Teks disimpan sebagai teks (jam/tanggal tidak diubah Sheets jadi angka), nomor baris tetap angka.
    log.getRange(to, 1, 1, copy.length).setValues([copy.map(function (x) { return typeof x === 'string' ? asText_(x) : x; })]);

    var noCell = sh.getRange(row, COL.NO);
    var no = noCell.getValue();
    var renumber = typeof no === 'number' && !noCell.getFormulas()[0][0];
    sh.deleteRow(row);
    // No. dipakai sebagai ID (di sheet asli sudah tidak berurutan), jadi nomor laporan lain TIDAK diubah.
    // Hanya kalau yang dihapus laporan terakhir: nomor siap-pakai di bawahnya (tanpa isi) dimundurkan,
    // supaya laporan berikutnya memakai nomor yang dihapus (mis. salah impor lalu dihapus).
    var renumbered = renumber && !hasDataFrom_(sh, row) ? renumberBelow_(sh, row, no) : 0;
    SpreadsheetApp.flush();
    return { sheet: cur.sheet, sheetId: cur.sheetId, row: row, no: cur.no, renumbered: renumbered, log: DELETED_SHEET };
  } finally {
    lock.releaseLock();
  }
}

/** Ada baris berisi (C atau D) mulai baris `from`? */
function hasDataFrom_(sh, from) {
  var last = sh.getLastRow();
  if (last < from) return false;
  return sh.getRange(from, COL.MACHINE, last - from + 1, 2).getValues().some(function (r) {
    return !isEmpty_(r[0]) || !isEmpty_(r[1]);
  });
}

/** Setelah baris bernomor `no` dihapus: No. berupa angka > no mulai baris `from` dikurangi 1. Rumus dibiarkan. */
function renumberBelow_(sh, from, no) {
  var last = sh.getLastRow();
  if (last < from) return 0;
  var range = sh.getRange(from, COL.NO, last - from + 1, 1);
  var vals = range.getValues();
  var formulas = range.getFormulas();
  var changed = 0;
  var out = vals.map(function (r, i) {
    if (formulas[i][0]) return [formulas[i][0]];
    if (typeof r[0] === 'number' && r[0] > no) { changed++; return [r[0] - 1]; }
    return [r[0]];
  });
  if (changed) range.setValues(out);
  return changed;
}
