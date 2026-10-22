/**
 * WeChat Import: SEMUA kode server dalam satu file, siap paste ke Code.gs.
 * DIBUAT OTOMATIS dari src/ (npm run build). Jangan edit di sini; ubah src/ lalu build ulang.
 */

// ======================= Config.gs =======================

/**
 * Semua konfigurasi di satu tempat. Ubah di sini, bukan di file lain.
 * File ini juga dimuat oleh test Node, jadi JANGAN panggil layanan Google di sini.
 */
var APP_NAME = 'WeChat Import';

// Struktur sheet manajer: header di baris 8, data mulai baris 9.
var ROW = {
  HEADER: 8,
  DATA_START: 9
};

// Nomor kolom (A = 1).
var COL = {
  NO: 2,          // B  No.序号
  MACHINE: 3,     // C  Machine
  DESC: 4,        // D  Issue Description
  ROOT_CAUSE: 5,  // E  Root Cause      -> selalu kosong + kuning (isi manual)
  SOLUTION: 6,    // F  Solution        -> selalu kosong + kuning (isi manual)
  END_TIME: 7,    // G  End Time
  DISCIPLINE: 8,  // H  Discipline (dropdown)
  PIC: 9,         // I  Responsibility
  DATE: 10,       // J  Date
  NOTES: 11       // K  Notes
};

// Sheet dianggap "sheet issue" hanya jika B8, C8, D8 diawali teks ini (huruf besar/kecil diabaikan).
// Pengaman: data tidak akan pernah ditulis ke sheet lain (mis. Revision_History).
var HEADER_CHECK = ['No.', 'Machine', 'Issue Description'];

// Proyek (②) -> nama sheet tujuan. Kunci: huruf besar, tanpa spasi/strip ("e-245" -> "E245").
// Proyek yang tidak ada di sini masuk ke sheet yang dipilih di UI.
var PROJECT_SHEET = {
  'E245': 'Geely list (2)'
};

// Isi dropdown kolom H. Harus sama persis dengan daftar di sheet (I2:I5).
var DISCIPLINES = ['Machine', 'Operation', 'Product Item', 'MES'];

// Jenis masalah (⑥-1) -> Discipline (H).
// Kunci: huruf kecil, tanpa spasi/strip/garis bawah ("Change over" -> "changeover").
// Jenis yang tidak ada di sini: H dikosongkan + kuning + peringatan. Tambahkan HANYA yang sudah pasti.
var DISCIPLINE_MAP = {
  'mesin': 'Machine',
  'machine': 'Machine',
  'operation': 'Operation',
  'productitem': 'Product Item',
  'mes': 'MES'
  // 'changeover': '???',  // BELUM DIPUTUSKAN: Change over masuk Discipline apa? (lihat README)
};

// Jenis (⑥-1) yang default TIDAK dicentang saat impor (mis. pergantian lem).
// Tetap tampil di pratinjau supaya laporan yang salah label bisa dicentang manual.
var SKIP_TYPES = ['changeover'];

var COLOR = {
  YELLOW: '#FFF2CC'  // sel yang harus dilengkapi manual
};

var FORMAT = {
  END_TIME: 'h:mm',
  DATE: 'yyyy/mm/dd'
};

var LOCK_TIMEOUT_MS = 10000;

// ======================= Parser.gs =======================

/**
 * Parser laporan WeChat format ①–⑨.
 *
 * Fungsi MURNI: tidak memakai SpreadsheetApp/Utilities, supaya bisa dites di Node
 * (test/parser.test.js). Aturan utamanya: JANGAN mengarang data. Field yang gagal
 * terbaca dikosongkan, ditandai di `missing` (kunci = nama kolom di COL -> sel kuning) dan dicatat di `warnings`
 * (-> kolom Notes), lengkap dengan teks aslinya supaya tidak ada yang hilang.
 *
 * Parsing dikunci pada SIMBOL (①..⑨, ⑥-1/⑥-2, ⑦-1/⑦-2), bukan teks labelnya.
 */

// `rank` dipakai untuk memisah laporan: begitu simbol yang muncul tidak lebih besar dari
// simbol sebelumnya, itu laporan berikutnya. Jadi laporan yang lupa menulis ① tetap terpisah.
var FIELDS = [
  { key: 'level',      mark: '①',   rank: 10, name: 'Level' },
  { key: 'project',    mark: '②',   rank: 20, name: 'Proyek' },
  { key: 'process',    mark: '③',   rank: 30, name: 'Proses' },
  { key: 'start',      mark: '④',   rank: 40, name: 'Waktu kejadian' },
  { key: 'desc',       mark: '⑤',   rank: 50, name: 'Deskripsi' },
  { key: 'type',       mark: '⑥-1', rank: 61, name: 'Jenis masalah' },
  { key: 'pic',        mark: '⑥-2', rank: 62, name: 'PIC' },
  { key: 'lineStatus', mark: '⑦-1', rank: 71, name: 'Status lini' },
  { key: 'handling',   mark: '⑦-2', rank: 72, name: 'Status penanganan' },
  { key: 'end',        mark: '⑧',   rank: 80, name: 'Waktu penutupan' },
  { key: 'duration',   mark: '⑨',   rank: 90, name: 'Durasi' }
];

var FIELD_BY_MARK = {};
var FIELD_BY_KEY = {};
FIELDS.forEach(function (f) { FIELD_BY_MARK[f.mark] = f; FIELD_BY_KEY[f.key] = f; });

// ⑥/⑦ boleh ditulis "⑥-1", "⑥ - 1", "⑥1", atau "⑥" saja (lihat resolveSub_).
var MARKER_RE = /([①②③④⑤⑧⑨])|([⑥⑦])(?:\s*[-–—]\s*([12])|([12]))?/g;

// ---------- API utama ----------

/**
 * Teks paste (boleh berisi banyak laporan) -> array record, terurut dari jam kejadian
 * paling awal. Laporan tanpa tanggal/jam kejadian yang valid ditaruh paling akhir.
 * Teks tanpa simbol ①–⑨ sama sekali -> [].
 */
function parseReports(text) {
  var blocks = [];
  tokenize_(normalizeText_(text)).forEach(function (t) {
    if (t.startsNew) blocks.push([]);
    blocks[blocks.length - 1].push(t);
  });
  var recs = blocks.map(buildRecord_);
  recs.sort(function (a, b) {
    var ka = sortKey_(a), kb = sortKey_(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.index - b.index;
  });
  var seen = {};
  recs.forEach(function (r, i) {
    r.id = i;
    if (!r.writable) return;
    if (seen.hasOwnProperty(r.key)) r.duplicateOf = { where: 'paste', id: seen[r.key] };
    else seen[r.key] = r.id;
  });
  return recs;
}

/** Satu laporan (teks) -> record. Kalau teks berisi beberapa laporan, hanya yang pertama. */
function parseOne(text, index) {
  var tokens = tokenize_(normalizeText_(text));
  var block = [];
  for (var i = 0; i < tokens.length; i++) {
    if (i > 0 && tokens[i].startsNew) break;
    block.push(tokens[i]);
  }
  return block.length ? buildRecord_(block, index || 0) : null;
}

/**
 * "2026.10.20/ 18:05" -> { date: {y, m, d}, time: {h, mi} }. Bagian yang tidak valid = null.
 * Tanggal hanya diterima tahun-bulan-hari (YYYY.MM.DD, pemisah . - /). "20/10/2026" ditolak
 * karena DD/MM vs MM/DD ambigu. Jam boleh "18:05" atau "18.05".
 */
function parseDateTime(s) {
  var str = String(s == null ? '' : s);
  var out = { date: null, time: null };
  var rest = str;
  var dm = /(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?!\d)/.exec(str);
  if (dm) {
    if (isValidDate_(+dm[1], +dm[2], +dm[3])) out.date = { y: +dm[1], m: +dm[2], d: +dm[3] };
    rest = str.slice(0, dm.index) + ' ' + str.slice(dm.index + dm[0].length);
  }
  // Buang pola mirip tanggal lain (mis. 20.10.2026) supaya "20.10" tidak terbaca sebagai jam.
  rest = rest.replace(/\d{1,4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,4}/g, ' ');
  var tm = /(?:^|\D)(\d{1,2})\s*[:.]\s*(\d{2})(?!\d)/.exec(rest);
  if (tm && +tm[1] <= 23 && +tm[2] <= 59) out.time = { h: +tm[1], mi: +tm[2] };
  return out;
}

// ---------- Tokenizer ----------

function normalizeText_(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    // Karakter full-width dari IME Mandarin: ：／＠１８ -> :/@18
    .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[​-‍⁠﻿]/g, '')
    // Spasi khusus (termasuk   yang dipakai WeChat setelah @mention) -> spasi biasa.
    .replace(/[   -   　]/g, ' ');
}

function tokenize_(text) {
  var re = new RegExp(MARKER_RE.source, 'g');
  var tokens = [];
  var maxRank = 0;
  var m;
  while ((m = re.exec(text)) !== null) {
    var mark = m[1] || (m[2] + '-' + (m[3] || m[4] || resolveSub_(m[2], maxRank)));
    var field = FIELD_BY_MARK[mark];
    var startsNew = tokens.length === 0 || field.rank <= maxRank;
    maxRank = field.rank;
    tokens.push({ field: field, start: m.index, end: re.lastIndex, startsNew: startsNew });
  }
  tokens.forEach(function (t, i) {
    t.raw = text.slice(t.end, i + 1 < tokens.length ? tokens[i + 1].start : text.length);
  });
  return tokens;
}

/** "⑥" tanpa -1/-2: pakai sub berikutnya yang belum terpakai di laporan ini. */
function resolveSub_(base, maxRank) {
  var r1 = FIELD_BY_MARK[base + '-1'].rank;
  if (maxRank < r1) return '1';
  return maxRank < r1 + 1 ? '2' : '1';
}

// ---------- Record ----------

function buildRecord_(tokens, index) {
  var raw = {};
  tokens.forEach(function (t) { raw[t.field.key] = t.raw; });
  var rec = { index: index, warnings: [], missing: {} };

  rec.level = textField_(rec, raw, 'level', null);
  rec.project = textField_(rec, raw, 'project', 'MACHINE');
  rec.process = textField_(rec, raw, 'process', 'MACHINE');
  rec.start = dateTimeField_(rec, raw, 'start');
  rec.description = textField_(rec, raw, 'desc', 'DESC', true);
  rec.type = textField_(rec, raw, 'type', 'DISCIPLINE');
  rec.pic = picField_(rec, raw);
  rec.lineStatus = textField_(rec, raw, 'lineStatus', null);
  rec.handling = textField_(rec, raw, 'handling', null);
  rec.end = dateTimeField_(rec, raw, 'end');
  rec.reportedDuration = durationField_(rec, raw);

  rec.machine = [rec.project, rec.process].filter(Boolean).join(' - ');
  if (!rec.start.date) rec.missing.DATE = true;
  if (!rec.end.time) rec.missing.END_TIME = true;

  rec.discipline = rec.type ? (DISCIPLINE_MAP[typeKey_(rec.type)] || '') : '';
  rec.disciplineManual = false;
  if (rec.type && !rec.discipline) {
    rec.missing.DISCIPLINE = true;
    warn_(rec, 'DISCIPLINE', '⑥-1 jenis "' + rec.type + '" belum dipetakan ke Discipline');
  }
  rec.skip = !!rec.type && SKIP_TYPES.indexOf(typeKey_(rec.type)) !== -1;

  computeDuration_(rec);

  // Baris dianggap kosong kalau C dan D kosong; menulis record seperti itu berarti
  // akan tertimpa impor berikutnya. Jadi record tanpa Machine & Deskripsi tidak ditulis.
  rec.writable = !!(rec.machine || rec.description);
  if (!rec.writable) warn_(rec, null, 'Machine (②③) dan Deskripsi (⑤) kosong — tidak bisa ditulis');
  rec.key = recordKey_(rec.machine, rec.description, fmtTime_(rec.end.time), fmtDate_(rec.start.date));
  return rec;
}

function warn_(rec, col, msg) {
  rec.warnings.push({ col: col, msg: msg });
}

/** Label = teks tanpa angka di baris pertama sebelum ":" pertama. */
function splitLabel_(raw) {
  var m = /^[^:\d\n]*:/.exec(raw);
  return m ? { hasColon: true, value: raw.slice(m[0].length) } : { hasColon: false, value: raw };
}

function cleanLines_(s) {
  return String(s).split('\n')
    .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
    .filter(function (l) { return l !== ''; });
}

/** "-", "/", "?" dsb. dianggap kosong. */
function isBlank_(s) {
  return /^[\s\-–—\/.?]*$/.test(String(s == null ? '' : s));
}

function clip_(s) {
  s = cleanLines_(s).join(' ');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function fieldProblem_(rec, key, col, problem) {
  var f = FIELD_BY_KEY[key];
  if (col) rec.missing[col] = true;
  warn_(rec, col, f.mark + ' ' + f.name + ' ' + problem);
}

function textField_(rec, raw, key, col, multiline) {
  var r = raw[key];
  if (r === undefined) { fieldProblem_(rec, key, col, 'tidak ada'); return ''; }
  var lab = splitLabel_(r);
  if (!lab.hasColon) {
    fieldProblem_(rec, key, col, 'tanpa ":" (label & isi tidak bisa dipisah): "' + clip_(r) + '"');
    return '';
  }
  var lines = cleanLines_(lab.value);
  var val = multiline ? lines.join('\n') : (lines[0] || '');
  if (isBlank_(val)) { fieldProblem_(rec, key, col, 'kosong'); return ''; }
  return val;
}

function picField_(rec, raw) {
  var r = raw.pic;
  if (r === undefined) { fieldProblem_(rec, 'pic', 'PIC', 'tidak ada'); return ''; }
  var lab = splitLabel_(r);
  var text = lab.hasColon ? lab.value : (r.indexOf('@') !== -1 ? r.slice(r.indexOf('@')) : null);
  if (text === null) {
    fieldProblem_(rec, 'pic', 'PIC', 'tanpa ":" (label & isi tidak bisa dipisah): "' + clip_(r) + '"');
    return '';
  }
  text = cleanLines_(text).join(' ');
  var names = text.indexOf('@') === -1 ? [text] : text.split('@');
  var out = names
    .map(function (n) { return n.replace(/[,;、]+\s*$/, '').trim(); })
    .filter(function (n) { return !isBlank_(n); })
    .join(', ');
  if (!out) fieldProblem_(rec, 'pic', 'PIC', 'kosong');
  return out;
}

function dateTimeField_(rec, raw, key) {
  var r = raw[key];
  // Kolom yang terdampak: ④ -> DATE (tanggal), ⑧ -> END_TIME (jam).
  var col = key === 'start' ? 'DATE' : 'END_TIME';
  if (r === undefined) {
    fieldProblem_(rec, key, col, 'tidak ada');
    return { date: null, time: null, raw: '' };
  }
  // Tanpa ":" pun tetap dicoba: pola tanggal/jam cukup spesifik untuk dicari di seluruh teks.
  var line = cleanLines_(splitLabel_(r).value)[0] || '';
  var dt = parseDateTime(line);
  dt.raw = line;
  var problem = '';
  if (!dt.date && !dt.time) problem = isBlank_(line) ? 'kosong' : 'tidak terbaca: "' + clip_(line) + '"';
  else if (!dt.date) problem = 'tanggal tidak terbaca: "' + clip_(line) + '"';
  else if (!dt.time) problem = 'jam tidak terbaca: "' + clip_(line) + '"';
  if (problem) {
    var affected = (key === 'start' && !dt.date) || (key === 'end' && !dt.time);
    fieldProblem_(rec, key, affected ? col : null, problem);
  }
  return dt;
}

function durationField_(rec, raw) {
  var r = raw.duration;
  if (r === undefined) return null; // tidak wajib: durasi dihitung ulang dari ④ dan ⑧
  var line = cleanLines_(splitLabel_(r).value)[0] || '';
  if (isBlank_(line)) return null;
  var n = parseDurationMinutes_(line);
  if (n === null) fieldProblem_(rec, 'duration', null, 'tidak terbaca: "' + clip_(line) + '"');
  return n;
}

/** "18 menit", "8 Menit", "16", "1 jam 5 menit" -> menit. Angka tanpa satuan = menit. */
function parseDurationMinutes_(s) {
  var t = String(s).toLowerCase();
  var num = function (x) { return parseFloat(x.replace(',', '.')); };
  var h = /(\d+(?:[.,]\d+)?)\s*(?:jam|hours?|hrs?|h)\b/.exec(t);
  var m = /(\d+(?:[.,]\d+)?)\s*(?:menit|mnt|min(?:ute)?s?|m)\b/.exec(t);
  if (h || m) return Math.round((h ? num(h[1]) * 60 : 0) + (m ? num(m[1]) : 0));
  var n = /(\d+(?:[.,]\d+)?)/.exec(t);
  return n ? num(n[1]) : null;
}

function computeDuration_(rec) {
  var s = rec.start, e = rec.end;
  rec.duration = null;
  if (!(s.date && s.time && e.date && e.time)) return;
  var d = epochMinutes_(e) - epochMinutes_(s);
  if (d < 0) { warn_(rec, null, '⑧ lebih awal dari ④ — cek tanggal/jam'); return; }
  rec.duration = d;
  if (d > 24 * 60) warn_(rec, null, 'Durasi ' + d + ' menit (> 24 jam) — cek tanggal ④/⑧');
  if (rec.reportedDuration !== null && rec.reportedDuration !== d) {
    warn_(rec, null, '⑨ tertulis ' + rec.reportedDuration + ' menit, hitungan ④→⑧ = ' + d + ' menit');
  }
}

// ---------- Pemetaan ke kolom sheet ----------

function typeKey_(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_.]+/g, '');
}

function projectKey_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function targetSheetName_(rec, otherSheet) {
  return PROJECT_SHEET[projectKey_(rec.project)] || otherSheet;
}

/**
 * Discipline yang dipilih di pratinjau. undefined/null = pakai hasil otomatis.
 * Nilai di luar DISCIPLINES diabaikan (sel H punya validasi dropdown).
 */
function applyDisciplineChoice_(rec, choice) {
  if (choice === undefined || choice === null || choice === rec.discipline) return rec;
  if (choice !== '' && DISCIPLINES.indexOf(choice) === -1) return rec;
  rec.discipline = choice;
  rec.disciplineManual = true;
  rec.warnings = rec.warnings.filter(function (w) { return w.col !== 'DISCIPLINE'; });
  rec.missing.DISCIPLINE = !choice;
  if (!choice) warn_(rec, 'DISCIPLINE', 'Discipline dikosongkan manual');
  return rec;
}

/** Nilai per kolom (kunci = nama di COL) + daftar kolom yang diberi latar kuning. */
function buildRow_(rec) {
  var yellow = ['ROOT_CAUSE', 'SOLUTION'];
  ['MACHINE', 'DESC', 'END_TIME', 'DISCIPLINE', 'PIC', 'DATE'].forEach(function (k) {
    if (rec.missing[k]) yellow.push(k);
  });
  return {
    values: {
      MACHINE: rec.machine,
      DESC: rec.description,
      END_TIME: rec.end.time ? timeSerial_(rec.end.time) : '',
      DISCIPLINE: rec.discipline,
      PIC: rec.pic,
      DATE: rec.start.date ? dateSerial_(rec.start.date) : '',
      NOTES: buildNotes_(rec)
    },
    yellow: yellow
  };
}

function buildNotes_(rec) {
  var info = [
    'Level: ' + (rec.level || '-'),
    'Mulai: ' + (fmtTime_(rec.start.time) || '-'),
    'Durasi: ' + durationText_(rec),
    'Jenis: ' + (rec.type || '-'),
    'Lini: ' + (rec.lineStatus || '-'),
    'Penanganan: ' + (rec.handling || '-')
  ];
  if (rec.start.date && rec.end.date && fmtDate_(rec.start.date) !== fmtDate_(rec.end.date)) {
    info.push('Selesai: ' + fmtDate_(rec.end.date) + (rec.end.time ? ' ' + fmtTime_(rec.end.time) : ''));
  }
  if (rec.disciplineManual) info.push('Discipline dipilih manual');
  var lines = [info.join(' | ')];
  rec.warnings.forEach(function (w) { lines.push('⚠ ' + w.msg); });
  return lines.join('\n');
}

function durationText_(rec) {
  if (rec.duration !== null) return rec.duration + ' menit';
  if (rec.reportedDuration !== null) return rec.reportedDuration + ' menit (dari ⑨, belum diverifikasi)';
  return '-';
}

/** Kunci deteksi duplikat: Machine | Deskripsi | End Time | Date (seperti tampil di sheet). */
function recordKey_(c, d, g, j) {
  return [c, d, g, j].map(function (s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  }).join('|');
}

// ---------- Tanggal & jam (tanpa Date lokal: kebal perbedaan timezone) ----------

function isValidDate_(y, m, d) {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
}

function epochMinutes_(dt) {
  return Date.UTC(dt.date.y, dt.date.m - 1, dt.date.d, dt.time.h, dt.time.mi) / 60000;
}

function sortKey_(rec) {
  return (rec.start.date && rec.start.time) ? epochMinutes_(rec.start) : Infinity;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function fmtDate_(d) {
  return d ? d.y + '/' + pad2_(d.m) + '/' + pad2_(d.d) : '';
}

/** "h:mm" seperti tampilan kolom G (jam tanpa nol di depan). */
function fmtTime_(t) {
  return t ? t.h + ':' + pad2_(t.mi) : '';
}

/** Nomor seri tanggal Sheets (hari sejak 1899-12-30). */
function dateSerial_(d) {
  return (Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Pecahan hari: 18:23 -> 0.7659… (format sel h:mm). */
function timeSerial_(t) {
  return (t.h * 60 + t.mi) / 1440;
}

// ======================= Sheet.gs =======================

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
 * - E & F (Root Cause, Solution) tidak pernah diisi, hanya diberi latar kuning.
 * - G dan J ditulis sebagai nomor seri + format sel, bukan objek Date,
 *   jadi hasilnya tidak bergeser walau timezone script ≠ timezone spreadsheet.
 */
function writeRecord(sh, row, rec) {
  var out = buildRow_(rec);
  ['MACHINE', 'DESC', 'PIC'].forEach(function (k) { out.values[k] = asText_(out.values[k]); });
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

// ======================= Ui.gs =======================

/**
 * Entry point: menu spreadsheet, dialog, dan web app. Keduanya memakai halaman yang sama (Index).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WeChat Import')
    .addItem('Import laporan WeChat…', 'showImportDialog')
    .addSeparator()
    .addItem('Cek setup', 'setup')
    .addToUi();
}

/**
 * Jalankan sekali setelah paste kode (Run dari editor), atau dari menu "Cek setup".
 * Memicu izin akses, menyamakan timezone spreadsheet dengan manifest, lalu MEMERIKSA
 * konfigurasi terhadap sheet asli. Tidak mengubah data apa pun. Aman dijalankan berulang.
 */
function setup() {
  var ss = ss_();
  var lines = [];
  var problems = 0;
  var ok = function (s) { lines.push('✓ ' + s); };
  var bad = function (s) { lines.push('✗ ' + s); problems++; };

  var tz = Session.getScriptTimeZone();
  var oldTz = ss.getSpreadsheetTimeZone();
  if (oldTz !== tz) {
    ss.setSpreadsheetTimeZone(tz);
    ok('Timezone spreadsheet diubah: ' + oldTz + ' → ' + tz);
  } else {
    ok('Timezone spreadsheet: ' + tz);
  }

  var sheets = issueSheetNames_(ss);
  if (sheets.length) ok('Sheet issue (header baris ' + ROW.HEADER + '): ' + sheets.join(', '));
  else bad('Tidak ada sheet dengan header ' + HEADER_CHECK.join(' | ') + ' di baris ' + ROW.HEADER + '. Tool tidak akan menulis apa pun.');

  Object.keys(PROJECT_SHEET).forEach(function (p) {
    var name = PROJECT_SHEET[p];
    if (sheets.indexOf(name) !== -1) ok('Proyek ' + p + ' → "' + name + '"');
    else bad('Proyek ' + p + ' → "' + name + '" tidak ditemukan / bukan sheet issue. Ubah PROJECT_SHEET di Config.');
  });

  sheets.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var dd = dropdownValues_(sh);
    var next = 'baris berikutnya ' + findNextRow(sh);
    if (!dd) { ok('"' + name + '": ' + next + ', kolom H tanpa dropdown'); return; }
    var missing = DISCIPLINES.filter(function (d) { return dd.indexOf(d) === -1; });
    if (missing.length) bad('"' + name + '": dropdown H [' + dd.join(', ') + '] tidak berisi ' + missing.join(', ') + '. Samakan DISCIPLINES di Config.');
    else ok('"' + name + '": ' + next + ', dropdown H cocok');
  });

  var summary = (problems ? problems + ' masalah ditemukan.' : 'Setup OK. Reload spreadsheet, lalu pakai menu WeChat Import.') + '\n\n' + lines.join('\n');
  console.log(summary);
  try {
    SpreadsheetApp.getUi().alert(APP_NAME + ': cek setup', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Dijalankan dari editor saat spreadsheet tidak terbuka: hasil cukup di Execution log.
  }
  return summary;
}

function showImportDialog() {
  SpreadsheetApp.getUi().showModalDialog(page_('dialog').setWidth(1100).setHeight(760), APP_NAME);
}

function doGet() {
  return page_('webapp')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function page_(mode) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.mode = mode;
  return t.evaluate();
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Data awal UI. Sheet default untuk proyek lain = sheet aktif kalau itu sheet issue
 * (dari menu), selain itu sheet issue pertama yang bukan tujuan PROJECT_SHEET (web app
 * tidak punya "sheet aktif").
 */
function getInitData() {
  var ss = ss_();
  var sheets = issueSheetNames_(ss);
  var reserved = Object.keys(PROJECT_SHEET).map(function (k) { return PROJECT_SHEET[k]; });
  var free = sheets.filter(function (n) { return reserved.indexOf(n) === -1; });
  var active = ss.getActiveSheet().getName();
  return {
    appName: APP_NAME,
    spreadsheetName: ss.getName(),
    url: ss.getUrl(),
    sheets: sheets,
    defaultOther: free.indexOf(active) !== -1 ? active : (free[0] || sheets[0] || ''),
    projectSheets: Object.keys(PROJECT_SHEET).map(function (k) {
      return { project: k, sheet: PROJECT_SHEET[k], ok: sheets.indexOf(PROJECT_SHEET[k]) !== -1 };
    }),
    disciplines: DISCIPLINES,
    headerRow: ROW.HEADER
  };
}
