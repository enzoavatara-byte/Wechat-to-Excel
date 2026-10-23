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

/** Satu baris sheet sebagai objek untuk UI. `cur` = nilai tampilan B:K, `notes` = catatan B:K. */
function completeRow_(name, sheetId, row, cur, notes) {
  var get = function (k) { return cur[COL[k] - COL.NO]; };
  var note = function (k) { return notes[COL[k] - COL.NO]; };
  // E/F perlu dikerjakan kalau kosong, atau berisi teks Indonesia yang belum diterjemahkan.
  var todo = function (k) { return isEmpty_(get(k)) || !hasChinese_(get(k)); };
  var need = ['ROOT_CAUSE', 'SOLUTION'].filter(todo);
  if (isEmpty_(get('DISCIPLINE'))) need.push('DISCIPLINE');
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
    dateShown: get('DATE'),
    need: need.map(function (k) { return { key: k, col: colLetter_(COL[k]) }; })
  };
}

function readRows_(sh, from, n) {
  var range = sh.getRange(from, COL.NO, n, COL.NOTES - COL.NO + 1);
  return { vals: range.getDisplayValues(), notes: range.getNotes() };
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
    disciplines: DISCIPLINES
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
    ['machine', 'description', 'rootCause', 'solution', 'discipline'].forEach(function (k) {
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
    if (!fields.length && !disc) throw new Error('Tidak ada yang diisi.');

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
    SpreadsheetApp.flush();

    var after = readRows_(sh, row, 1);
    return completeRow_(sh.getName(), sh.getSheetId(), row, after.vals[0], after.notes[0]);
  } finally {
    lock.releaseLock();
  }
}
