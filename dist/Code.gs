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
// Diisi otomatis oleh `npm run build` (dist/). Tampil di UI & setup untuk memastikan kode terbaru yang jalan.
var APP_VERSION = '2034eef';

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
  ROOT_CAUSE: 5,  // E  Root Cause      -> selalu kosong (isi manual)
  SOLUTION: 6,    // F  Solution        -> selalu kosong (isi manual)
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
// Jenis yang tidak ada di sini: H dikosongkan + peringatan. Tambahkan HANYA yang sudah pasti.
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

// ---------- Terjemahan (Translate.gs) ----------

// true: C, D, K ditulis "中文\n(English)" seperti sheet manajer. false: Bahasa Indonesia apa adanya.
var TRANSLATE = true;

// Istilah tetap: dipakai apa adanya, tidak lewat terjemahan mesin. [中文, English]
// Kunci: huruf kecil, tanpa spasi/strip/titik ("Mesin pulih" -> "mesinpulih").
// Tambahkan nama proses (③) setelah dicek ke mentor/manajer; sampai itu, proses diterjemahkan mesin
// dan diberi peringatan.
var TERMS = {
  'changeover': ['换型', 'Changeover'],          // istilah file manajer: "频繁换型 (Frequent changeovers)"
  'preassy': ['预装', 'Pre-assembly'],           // file manajer: "箱体预装工位 (Enclosure Pre-assembly Station)"
  'mesin': ['设备', 'Machine'],
  'mesinpulih': ['设备已恢复', 'Machine recovered'],
  'mesinpulihkembali': ['设备已恢复', 'Machine recovered'],
  'selesaipenanganan': ['处理完成', 'Handling completed'],
  'sudahpenanganan': ['已处理', 'Handled']
  // 'finishing': ['…', 'Finishing'],
  // 'pressmodul': ['…', 'Module Press'],
};

// Ganti pilihan kata mesin dengan istilah yang dipakai di file manajer.
var ZH_FIXES = [
  ['模块', '模组']  // module: file manajer selalu memakai 模组
];

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
 * terbaca dikosongkan, ditandai di `missing` (kunci = nama kolom di COL) dan dicatat di `warnings`
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
    .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    // Spasi khusus (termasuk \u2005 yang dipakai WeChat setelah @mention) -> spasi biasa.
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
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

/** `routes` = kode proyek -> sheet (lihat projectRoutes_); default PROJECT_SHEET dari Config. */
function targetSheetName_(rec, otherSheet, routes) {
  return (routes || PROJECT_SHEET)[projectKey_(rec.project)] || otherSheet;
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

/**
 * Nilai per kolom (kunci = nama di COL), kolom yang masih kosong (dilengkapi manual), dan catatan sel.
 * Kalau rec.tr ada (sudah diterjemahkan, lihat Translate.gs): C, D, K jadi "中文\n(English)" dan
 * teks asli + peringatan pindah ke catatan sel. Tanpa terjemahan: Bahasa Indonesia apa adanya.
 */
function buildRow_(rec) {
  var empty = ['ROOT_CAUSE', 'SOLUTION'];
  ['MACHINE', 'DESC', 'END_TIME', 'DISCIPLINE', 'PIC', 'DATE'].forEach(function (k) {
    if (rec.missing[k]) empty.push(k);
  });
  var tr = !!rec.tr;
  return {
    values: {
      MACHINE: tr ? machineBi_(rec) : rec.machine,
      DESC: tr ? descBi_(rec) : rec.description,
      END_TIME: rec.end.time ? timeSerial_(rec.end.time) : '',
      DISCIPLINE: rec.discipline,
      PIC: rec.pic,
      DATE: rec.start.date ? dateSerial_(rec.start.date) : '',
      NOTES: tr ? notesBi_(rec) : buildNotes_(rec)
    },
    notes: tr ? cellNotes_(rec) : {},
    empty: empty
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

// ======================= Translate.gs =======================

/**
 * Terjemahan ke format sheet manajer: "中文\n(English)",
 * mis. "E245模组入箱\n(E245 module installation into enclosure)".
 *
 * Mesin: LanguageApp (Google Translate bawaan Apps Script; gratis, ±5.000 panggilan/hari untuk akun Gmail).
 * Alur Indonesia -> Inggris -> Mandarin, supaya kedua bahasa mengatakan hal yang sama.
 * Istilah di TERMS (Config) tidak lewat mesin. Semua teks satu impor dikirim sekaligus (satu panggilan
 * per bahasa). Teks asli Bahasa Indonesia disimpan sebagai catatan sel, jadi tidak hilang kalau
 * terjemahan mesin keliru, dan tetap dipakai untuk deteksi duplikat.
 */
var NOTE_PREFIX = 'Asli (ID): ';
var TRANSLATE_CHUNK_CHARS = 4000;

function wantTranslate_(opts) {
  return TRANSLATE && !(opts && opts.translate === false);
}

/**
 * Isi rec.tr = { process, desc, type, lineStatus, handling }, masing-masing { zh, en, mt } atau null.
 * `translateFn(texts, from, to)` bisa diganti (test). Kalau penerjemah gagal, error dilempar dan
 * tidak ada record yang berubah.
 */
function translateRecords_(recs, translateFn) {
  var fn = translateFn || translateTexts_;
  var fields = ['process', 'description', 'type', 'lineStatus', 'handling'];
  var index = {};
  var sources = [];
  recs.forEach(function (r) {
    fields.forEach(function (f) {
      var s = r[f];
      if (s && !TERMS.hasOwnProperty(typeKey_(s)) && !index.hasOwnProperty(s)) {
        index[s] = sources.length;
        sources.push(s);
      }
    });
  });
  var en = sources.length ? fn(sources, 'id', 'en') : [];
  var zh = en.length ? fn(en, 'en', 'zh-CN').map(fixZh_) : [];
  var tr = function (s) {
    if (!s) return null;
    var t = TERMS[typeKey_(s)];
    if (t) return { zh: t[0], en: t[1], mt: false };
    return { zh: zh[index[s]], en: en[index[s]], mt: true };
  };
  recs.forEach(function (r) {
    r.tr = { process: tr(r.process), desc: tr(r.description), type: tr(r.type), lineStatus: tr(r.lineStatus), handling: tr(r.handling) };
    if (r.tr.process && r.tr.process.mt) {
      warn_(r, null, '③ "' + r.process + '" diterjemahkan mesin: ' + r.tr.process.zh + ' / ' + r.tr.process.en +
        '. Kalau sudah benar, tambahkan ke TERMS di Config supaya konsisten.');
    }
  });
  return recs;
}

/** Istilah file manajer menang atas pilihan kata mesin (mis. 模块 -> 模组). */
function fixZh_(s) {
  return ZH_FIXES.reduce(function (acc, f) { return acc.split(f[0]).join(f[1]); }, String(s));
}

/**
 * Terjemahkan array teks (boleh multi-baris), hemat kuota Google Translate:
 * 1. Baris yang pernah diterjemahkan (6 jam terakhir) diambil dari cache, tanpa panggilan.
 * 2. Sisanya dikirim sekaligus per potongan ±4.000 karakter (satu panggilan per bahasa).
 *    Kalau jumlah baris hasil tidak cocok, diulang SEKALI dalam mode HTML (tiap baris = <p>),
 *    baru kalau masih tidak cocok per baris dengan jeda (bukan beruntun).
 * 3. Kena batas per menit -> tunggu lalu coba lagi. Kuota harian habis -> pakai rumus
 *    GOOGLETRANSLATE di sheet sementara (kuota terpisah dari LanguageApp).
 */
function translateTexts_(texts, from, to) {
  var lines = [];
  var counts = [];
  texts.forEach(function (t) {
    var ls = String(t).split('\n');
    counts.push(ls.length);
    Array.prototype.push.apply(lines, ls);
  });
  var done = cacheGet_(lines, from, to);
  var todo = [];
  lines.forEach(function (l) {
    if (l.trim() && !done.hasOwnProperty(l) && todo.indexOf(l) === -1) todo.push(l);
  });
  if (todo.length) {
    var res = translateLines_(todo, from, to);
    var fresh = {};
    todo.forEach(function (l, i) { fresh[l] = done[l] = res[i].trim(); });
    cachePut_(fresh, from, to);
  }
  var result = [];
  var k = 0;
  counts.forEach(function (n) {
    result.push(lines.slice(k, k + n).map(function (l) { return l.trim() ? done[l] : ''; }).join('\n'));
    k += n;
  });
  return result;
}

/** Baris unik (tanpa baris kosong) -> terjemahan, dengan LanguageApp lalu cadangan rumus. */
function translateLines_(lines, from, to) {
  try {
    var out = [];
    chunkLines_(lines, TRANSLATE_CHUNK_CHARS).forEach(function (chunk) {
      var res = callTranslate_(chunk.join('\n'), from, to, 'text').split('\n');
      if (res.length !== chunk.length) res = translateHtml_(chunk, from, to);
      if (!res) res = chunk.map(function (l, i) { if (i) Utilities.sleep(300); return callTranslate_(l, from, to, 'text'); });
      Array.prototype.push.apply(out, res);
    });
    return out;
  } catch (e) {
    if (quotaKind_(e) !== 'day') throw e;
    try {
      return translateWithFormula_(lines, from, to);
    } catch (e2) {
      throw new Error('Kuota harian Google Translate untuk akun ini habis (' + translateCallsToday_() +
        ' panggilan hari ini), dan cadangan rumus GOOGLETRANSLATE juga gagal: ' + (e2.message || e2) +
        '. Kuota pulih ±24 jam setelah panggilan pertama hari itu.');
    }
  }
}

/** Potongan baris dalam satu panggilan HTML: tiap baris dibungkus <p>…</p>. null kalau tetap tidak cocok. */
function translateHtml_(chunk, from, to) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var html = chunk.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
  var out = callTranslate_(html, from, to, 'html');
  var res = [];
  var re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  var m;
  while ((m = re.exec(out)) !== null) res.push(m[1].replace(/<[^>]+>/g, '').trim());
  return res.length === chunk.length ? res : null;
}

function chunkLines_(lines, max) {
  var chunks = [];
  var cur = [];
  var size = 0;
  lines.forEach(function (l) {
    if (cur.length && size + l.length + 1 > max) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length + 1;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 'rate' = batas per menit ("in a short time"), 'day' = kuota harian, '' = error lain. */
function quotaKind_(e) {
  var m = String((e && e.message) || e);
  if (!/too many times/i.test(m)) return '';
  return /short time|per minute|rate/i.test(m) ? 'rate' : 'day';
}

/** Satu panggilan LanguageApp; batas per menit -> tunggu 2, 4, 8 detik lalu coba lagi. */
function callTranslate_(text, from, to, contentType) {
  var wait = 2000;
  for (var attempt = 0; ; attempt++) {
    try {
      countTranslateCall_();
      var out = LanguageApp.translate(text, from, to, { contentType: contentType || 'text' });
      return String(out).replace(/&(amp|lt|gt|quot|#39);/g, function (m, e) {
        return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e];
      });
    } catch (e) {
      if (quotaKind_(e) !== 'rate' || attempt >= 3) throw e;
      Utilities.sleep(wait);
      wait *= 2;
    }
  }
}

// ---------- Cadangan: rumus GOOGLETRANSLATE ----------

/**
 * Dipakai hanya kalau kuota harian LanguageApp habis. Baris ditulis ke sheet tersembunyi sementara
 * berisi =GOOGLETRANSLATE(A1, from, to), hasil dibaca, lalu sheet itu dihapus lagi.
 */
function translateWithFormula_(lines, from, to) {
  var ss = ss_();
  var prev = ss.getActiveSheet(); // insertSheet memindahkan tab aktif; dikembalikan setelah selesai
  var sh = ss.insertSheet('_wechat_translate_' + Date.now());
  try {
    sh.hideSheet();
    sh.getRange(1, 1, lines.length, 1).setValues(lines.map(function (l) { return [asText_(l)]; }));
    sh.getRange(1, 2, lines.length, 1).setFormulas(lines.map(function (l, i) {
      return ['=GOOGLETRANSLATE(A' + (i + 1) + ',"' + from + '","' + to + '")'];
    }));
    for (var attempt = 0; attempt < 30; attempt++) {
      SpreadsheetApp.flush();
      var out = sh.getRange(1, 2, lines.length, 1).getDisplayValues().map(function (r) { return String(r[0]); });
      var pending = out.some(function (v) { return !v.trim() || /^(Loading|Memuat)/i.test(v); });
      if (!pending) {
        var bad = out.filter(function (v) { return /^#[A-Z\/!?0-9]+/.test(v); });
        if (bad.length) throw new Error('hasil rumus ' + bad[0]);
        return out;
      }
      Utilities.sleep(500);
    }
    throw new Error('rumus belum selesai setelah 15 detik');
  } finally {
    ss.deleteSheet(sh);
    try { prev.activate(); } catch (e) { /* web app tanpa tampilan */ }
  }
}

// ---------- Cache & penghitung (opsional: kalau layanan tidak tersedia, dilewati) ----------

var TRANSLATE_CACHE_SECONDS = 6 * 3600; // batas maksimum CacheService

function cacheKey_(line, from, to) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, from + '>' + to + '|' + line, Utilities.Charset.UTF_8);
  return 'tr:' + Utilities.base64Encode(bytes);
}

function cacheGet_(lines, from, to) {
  var found = {};
  try {
    var keys = {};
    lines.forEach(function (l) { if (l.trim()) keys[cacheKey_(l, from, to)] = l; });
    var hit = CacheService.getScriptCache().getAll(Object.keys(keys));
    Object.keys(hit).forEach(function (k) { found[keys[k]] = hit[k]; });
  } catch (e) { /* tanpa cache */ }
  return found;
}

function cachePut_(map, from, to) {
  try {
    var vals = {};
    Object.keys(map).forEach(function (l) { vals[cacheKey_(l, from, to)] = map[l]; });
    CacheService.getScriptCache().putAll(vals, TRANSLATE_CACHE_SECONDS);
  } catch (e) { /* tanpa cache */ }
}

/** Perkiraan jumlah panggilan LanguageApp hari ini (UTC), untuk pesan error & setup. */
function translateCallsToday_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty('trCalls:' + new Date().toISOString().slice(0, 10)) || 0);
  } catch (e) {
    return '?';
  }
}

function countTranslateCall_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'trCalls:' + new Date().toISOString().slice(0, 10);
    props.setProperty(key, String(Number(props.getProperty(key) || 0) + 1));
  } catch (e) { /* tanpa penghitung */ }
}

// ---------- Format sel ----------

function bi_(zh, en) {
  return zh + '\n(' + en + ')';
}

/** C: "E245精加工\n(E245 Finishing)", seperti "E245模组入箱\n(E245 module installation into enclosure)". */
function machineBi_(rec) {
  var t = rec.tr && rec.tr.process;
  if (!t) return rec.machine; // tanpa ③ tidak ada yang diterjemahkan (mis. hanya "E245")
  var p = rec.project;
  var zh = p ? p + (/^[A-Za-z0-9]/.test(t.zh) ? ' ' : '') + t.zh : t.zh;
  return bi_(zh, [p, t.en].filter(Boolean).join(' '));
}

function descBi_(rec) {
  var t = rec.tr && rec.tr.desc;
  return t ? bi_(t.zh, t.en) : rec.description;
}

/** K: info laporan dalam dua bahasa. Peringatan internal ada di catatan sel, bukan di sini. */
function notesBi_(rec) {
  var t = rec.tr || {};
  var pick = function (x, lang) { return x ? x[lang] : '-'; };
  var d = rec.duration !== null ? rec.duration : rec.reportedDuration;
  var unverified = rec.duration === null && rec.reportedDuration !== null;
  var start = fmtTime_(rec.start.time) || '-';
  var zh = [
    '等级：' + (rec.level || '-'),
    '开始：' + start,
    '影响时长：' + (d !== null ? d + '分钟' + (unverified ? '（未核实）' : '') : '-'),
    '类型：' + pick(t.type, 'zh'),
    '产线状态：' + pick(t.lineStatus, 'zh'),
    '处理状态：' + pick(t.handling, 'zh')
  ];
  var en = [
    'Level: ' + (rec.level || '-'),
    'Start: ' + start,
    'Downtime: ' + (d !== null ? d + ' min' + (unverified ? ' (unverified)' : '') : '-'),
    'Type: ' + pick(t.type, 'en'),
    'Line status: ' + pick(t.lineStatus, 'en'),
    'Handling: ' + pick(t.handling, 'en')
  ];
  if (rec.start.date && rec.end.date && fmtDate_(rec.start.date) !== fmtDate_(rec.end.date)) {
    var end = fmtDate_(rec.end.date) + (rec.end.time ? ' ' + fmtTime_(rec.end.time) : '');
    zh.push('结束：' + end);
    en.push('End: ' + end);
  }
  return bi_(zh.join('；'), en.join('; '));
}

/** Catatan sel (muncul saat kursor di atas sel): teks asli + peringatan. */
function cellNotes_(rec) {
  var k = [NOTE_PREFIX + 'Level: ' + (rec.level || '-') + ' | Jenis: ' + (rec.type || '-') +
    ' | Lini: ' + (rec.lineStatus || '-') + ' | Penanganan: ' + (rec.handling || '-')];
  if (rec.disciplineManual) k.push('Discipline dipilih manual');
  rec.warnings.forEach(function (w) { k.push('⚠ ' + w.msg); });
  return {
    MACHINE: rec.machine ? NOTE_PREFIX + rec.machine : '',
    DESC: rec.description ? NOTE_PREFIX + rec.description : '',
    NOTES: k.join('\n')
  };
}

/** Teks asli dari catatan "Asli (ID): …" di kolom C/D, atau null. */
function originalFromNote_(note) {
  var s = String(note || '');
  return s.indexOf(NOTE_PREFIX) === 0 ? s.slice(NOTE_PREFIX.length) : null;
}

// ---------- Menu: terjemahkan sel terpilih ----------

// Kolom yang boleh diterjemahkan lewat menu. H (dropdown Discipline), I (nama orang), dan B/G/J
// (angka) tidak pernah diterjemahkan: menerjemahkan H melanggar validasi dropdown.
var TRANSLATABLE_COLS = ['MACHINE', 'DESC', 'ROOT_CAUSE', 'SOLUTION', 'NOTES'];

/**
 * Untuk teks yang diketik manual (mis. Root Cause/Solution setelah tanya mentor): sel terpilih
 * diubah ke "中文\n(English)", teks asli disimpan di catatan sel. Hanya sheet issue, baris data
 * (mulai baris 9), kolom C/D/E/F/K. Dilewati: sel kosong, angka/tanggal, rumus, sel ber-dropdown,
 * dan sel yang sudah berisi huruf Mandarin.
 */
function translateSelection() {
  var ui = SpreadsheetApp.getUi();
  var range = SpreadsheetApp.getActiveRange();
  var msg = range ? translateRange_(range).message : 'Pilih dulu sel yang mau diterjemahkan.';
  ui.alert(APP_NAME, msg, ui.ButtonSet.OK);
}

function translateRange_(range) {
  var max = 300;
  var sh = range.getSheet();
  if (!isIssueSheet_(sh)) {
    return { count: 0, message: 'Hanya untuk sheet issue (header di baris ' + ROW.HEADER + '). Sheet "' + sh.getName() + '" tidak diubah.' };
  }
  if (range.getNumRows() * range.getNumColumns() > max) {
    return { count: 0, message: 'Terlalu banyak sel dipilih (maks ' + max + ').' };
  }
  var cols = TRANSLATABLE_COLS.map(function (k) { return COL[k]; });
  var r0 = range.getRow();
  var c0 = range.getColumn();
  var vals = range.getValues();
  var formulas = range.getFormulas();
  var rules = range.getDataValidations();
  var targets = [];
  var skipped = 0;
  vals.forEach(function (row, i) {
    row.forEach(function (v, j) {
      if (typeof v !== 'string' || !v.trim() || formulas[i][j] || /[\u4e00-\u9fff]/.test(v)) return;
      if (r0 + i < ROW.DATA_START || cols.indexOf(c0 + j) === -1 || rules[i][j]) { skipped++; return; }
      targets.push({ i: i, j: j, text: cleanLines_(v).join('\n') });
    });
  });
  var note = skipped ? ' ' + skipped + ' sel dilewati (hanya kolom ' +
    cols.map(colLetter_).join('/') + ' mulai baris ' + ROW.DATA_START + '; dropdown, nama PIC, header tidak diterjemahkan).' : '';
  if (!targets.length) {
    return { count: 0, message: 'Tidak ada teks yang perlu diterjemahkan (sel kosong, angka, rumus, atau yang sudah berbahasa Mandarin dilewati).' + note };
  }
  // Terjemahkan semua dulu; baru menulis kalau terjemahan berhasil.
  var en = translateTexts_(targets.map(function (t) { return t.text; }), 'id', 'en');
  var zh = translateTexts_(en, 'en', 'zh-CN').map(fixZh_);
  var failed = [];
  var count = 0;
  targets.forEach(function (t, k) {
    var cell = range.getCell(t.i + 1, t.j + 1);
    try {
      cell.setValue(asText_(bi_(zh[k], en[k]))).setNote(NOTE_PREFIX + t.text);
      count++;
    } catch (e) {
      failed.push(cell.getA1Notation() + ': ' + (e.message || e));
    }
  });
  return {
    count: count,
    message: count + ' sel diterjemahkan ke 中文 + (English). Teks asli disimpan di catatan sel.' + note +
      (failed.length ? '\nGagal ditulis: ' + failed.join('; ') : '')
  };
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

// ======================= Edit.gs =======================

/**
 * Isi sel yang diubah manual di layar Periksa sebelum impor (tombol "✎ Edit" per laporan).
 *
 * Aturan teks C/D/E/F/K: kalau berisi huruf Mandarin -> ditulis apa adanya (mis. terjemahan yang
 * diperbaiki manual); kalau tidak -> dianggap Bahasa Indonesia dan diterjemahkan ke "中文\n(English)"
 * (kalau TRANSLATE). G (jam) dan J (tanggal) divalidasi; I (PIC) apa adanya. H tetap lewat dropdown.
 * Catatan sel C/D tetap berisi teks asli laporan (dipakai juga untuk deteksi duplikat).
 */
var EDIT_TEXT_KEYS = ['MACHINE', 'DESC', 'ROOT_CAUSE', 'SOLUTION', 'NOTES'];
var EDIT_KEYS = EDIT_TEXT_KEYS.concat(['END_TIME', 'PIC', 'DATE']);

/** "20:30" / "20.30" -> {h, mi}; selain itu null. */
function parseEditTime_(s) {
  var m = /^(\d{1,2})\s*[:.]\s*(\d{2})$/.exec(String(s).trim());
  return m && +m[1] <= 23 && +m[2] <= 59 ? { h: +m[1], mi: +m[2] } : null;
}

/** "2026/10/21" (atau . -) -> {y, m, d}; selain itu null. */
function parseEditDate_(s) {
  var m = /^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})$/.exec(String(s).trim());
  return m && isValidDate_(+m[1], +m[2], +m[3]) ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** "E245 - Finishing" -> { project: 'E245', process: 'Finishing' }, atau null. */
function splitMachine_(s) {
  var m = /^(.+?)\s+-\s+(.+)$/.exec(String(s).trim());
  return m ? { project: m[1].trim(), process: m[2].trim() } : null;
}

/**
 * items = [{ rec, cells: { KEY: teks } }]. Mengisi item.override = { values, notes } dan item.error.
 * Semua teks yang perlu diterjemahkan dikirim sekaligus; kalau penerjemah gagal, error dilempar
 * sebelum ada yang ditulis.
 */
function prepareEdits_(items, translate) {
  var jobs = [];
  items.forEach(function (it) {
    it.override = { values: {}, notes: {} };
    it.error = '';
    var cells = it.cells || {};
    var problems = [];
    Object.keys(cells).forEach(function (key) {
      if (EDIT_KEYS.indexOf(key) === -1) return;
      var raw = String(cells[key] == null ? '' : cells[key]);
      var col = colLetter_(COL[key]);
      if (key === 'END_TIME' || key === 'DATE') {
        if (!raw.trim()) { it.override.values[key] = ''; return; }
        var t = key === 'END_TIME' ? parseEditTime_(raw) : parseEditDate_(raw);
        if (!t) { problems.push(col + ' "' + raw.trim() + '" tidak valid (pakai ' + (key === 'END_TIME' ? 'jam:menit, mis. 20:30' : 'tahun/bulan/tanggal, mis. 2026/10/21') + ')'); return; }
        it.override.values[key] = key === 'END_TIME' ? timeSerial_(t) : dateSerial_(t);
        return;
      }
      var text = key === 'PIC' ? raw.replace(/\s+/g, ' ').trim() : cleanLines_(raw).join('\n');
      if (key === 'PIC' || !text || !translate || hasChinese_(text)) {
        it.override.values[key] = text;
        return;
      }
      var split = key === 'MACHINE' ? splitMachine_(text) : null;
      jobs.push({ it: it, key: key, text: text, project: split ? split.project : '', src: split ? split.process : text });
    });
    if (problems.length) it.error = problems.join('; ');
  });
  if (jobs.length) {
    var en = translateTexts_(jobs.map(function (j) { return j.src; }), 'id', 'en');
    var zh = translateTexts_(en, 'en', 'zh-CN').map(fixZh_);
    jobs.forEach(function (j, k) {
      var p = j.project;
      j.it.override.values[j.key] = p
        ? bi_(p + (/^[A-Za-z0-9]/.test(zh[k]) ? ' ' : '') + zh[k], p + ' ' + en[k])
        : bi_(zh[k], en[k]);
      if (j.key === 'ROOT_CAUSE' || j.key === 'SOLUTION') j.it.override.notes[j.key] = NOTE_PREFIX + j.text;
    });
  }
  items.forEach(function (it) {
    var v = it.override.values;
    var c = v.hasOwnProperty('MACHINE') ? v.MACHINE : it.rec.machine;
    var d = v.hasOwnProperty('DESC') ? v.DESC : it.rec.description;
    if (!it.error && !c && !d) it.error = 'Machine (C) dan Deskripsi (D) tidak boleh kosong dua-duanya';
  });
  return items;
}

/** Tombol "↻ Terjemahkan" di layar Periksa: pratinjau hasil satu sel tanpa menulis apa pun. */
function translateCell(key, text) {
  if (EDIT_TEXT_KEYS.indexOf(key) === -1) throw new Error('Kolom ini tidak diterjemahkan.');
  var it = { rec: { machine: 'x', description: 'x' }, cells: {} };
  it.cells[key] = text;
  prepareEdits_([it], TRANSLATE);
  return { value: it.override.values[key] };
}

// ======================= Template.gs =======================

/**
 * Menu "Buat sheet baru": membuat sheet issue dengan format sheet manajer.
 *
 * Semua nilai di bawah diambil dari file manajer
 * (Statistical_Analysis_of_Issues_Reported_from_Production.xlsx, sheet "LImo 7 list"),
 * termasuk yang aneh tapi disengaja sama persis: nomor 1–14 di muka, rumus
 * Total tasks =COUNT(B9:B204)-3, batas COUNTIF H679/H680/H681, legenda A1:A5 berteks putih,
 * dan conditional format N/A/G/Y/R di H9:H35.
 * Lebar kolom: satuan Excel × 7 px. Tinggi baris: pt × 4/3 px. Zoom 90% tidak bisa diatur lewat script.
 */
var TEMPLATE = {
  FONT: 'SimSun',            // 宋体, font default workbook manajer
  LAST_ROW: 35,              // baris data 9–35 berbingkai + dropdown, seperti file asli
  NUMBERED: 14,              // B9:B22 sudah bernomor 1–14
  REVISION_SHEET: 'Revision_History',
  TAB_COLOR: '#4F6228',      // Olive Green, Accent 3, Darker 50%
  GRAY: '#7F7F7F',           // White, Background 1, Darker 50%
  GREEN: '#00B050',
  COL_WIDTHS: [19, 64, 113, 179, 165, 165, 116, 99, 81, 97, 172],  // A..K
  ROW_HEIGHTS: [19, 19, 28, 30, 24, 19, 19, 38],                   // baris 1..8; baris data dibiarkan auto
  LEGEND: ['R', 'R', 'Y', 'G', 'N/A'],                               // A1:A5
  HEADERS: ['No.序号', 'Machine', 'Issue Description \n问题描述', 'Root Cause\n原因分析', 'Solution\n解决方案\n',
    'End Time\n解决时间', 'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes'],
  TITLE_FORMULA: '="ASSEMBLY & UPFIT PALLET PRE-ACCEPTANCE CHECKLIST - REV "&MAX(Revision_History!B5:B30)',
  // Status Overview G2:H5 (+ sumber dropdown di I2:I5)
  STATUS: [
    { label: 'Machine', fill: '#FF0000', text: '#FFFFFF', countTo: 679 },
    { label: 'Operation', fill: '#FFFF00', text: '#000000', countTo: 680 },
    { label: 'Product Item', fill: '#92D050', text: '#FFFFFF', countTo: 681 },
    { label: 'MES', fill: '#00B0F0', text: '#000000', countTo: 681 }
  ],
  // Format baris data per kolom B..K: [ukuran font, rata horizontal, wrap]
  DATA_COLS: [
    [10, 'center', false], [10, 'center', true], [10, 'left', true], [10, 'left', true], [10, 'center', true],
    [10, 'center', false], [11, 'center', false], [10, 'center', false], [11, 'center', false], [10, 'left', true]
  ],
  CF_COLORS: { 'N/A': '#00B0F0', 'G': '#92D050', 'Y': '#FFFF00', 'R': '#FF0000' }
};

/**
 * Dipanggil dari UI. opts = { sheetName, projectName, projectCode }.
 * Tidak pernah menimpa sheet yang sudah ada.
 */
function createIssueSheet(opts) {
  opts = opts || {};
  var name = String(opts.sheetName || '').trim();
  var projectName = String(opts.projectName || '').trim() || name;
  var code = projectKey_(opts.projectCode);
  if (!name) throw new Error('Nama sheet wajib diisi.');
  if (name.length > 100) throw new Error('Nama sheet maksimal 100 karakter.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Masih ada proses lain yang berjalan. Coba lagi beberapa detik.');
  try {
    var ss = ss_();
    if (ss.getSheetByName(name)) throw new Error('Sheet "' + name + '" sudah ada. Pakai nama lain.');
    var routes = projectRoutes_(ss);
    if (code && routes[code] && ss.getSheetByName(routes[code])) {
      throw new Error('Kode proyek ' + code + ' sudah dipakai sheet "' + routes[code] + '".');
    }

    var createdRevision = ensureRevisionSheet_(ss);
    var sh = ss.insertSheet(name, ss.getSheets().length);
    buildIssueSheet_(sh, projectName);
    if (code) sh.addDeveloperMetadata(ROUTE_META_KEY, code);
    SpreadsheetApp.flush();
    try { sh.activate(); } catch (e) { /* web app tidak punya tampilan sheet aktif */ }
    return {
      sheet: name,
      projectName: projectName,
      code: code,
      createdRevision: createdRevision,
      dataRows: ROW.DATA_START + '–' + TEMPLATE.LAST_ROW
    };
  } finally {
    lock.releaseLock();
  }
}

function buildIssueSheet_(sh, projectName) {
  var T = TEMPLATE;
  var arial = function (range, size) { return range.setFontFamily('Arial').setFontSize(size); };

  sh.getRange(1, 1, T.LAST_ROW, COL.NOTES).setFontFamily(T.FONT).setFontSize(11);
  T.COL_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  T.ROW_HEIGHTS.forEach(function (h, i) { sh.setRowHeight(i + 1, h); });
  sh.setHiddenGridlines(true);
  sh.setTabColor(T.TAB_COLOR);
  sh.setFrozenRows(ROW.HEADER);

  // Baris 1–5: legenda, identitas proyek, Status Overview, Total tasks
  arial(sh.getRange('A1:A5'), 10).setValues(T.LEGEND.map(function (v) { return [v]; }))
    .setFontColor('#FFFFFF').setHorizontalAlignment('center');
  arial(sh.getRange('G1'), 10).setValue('Status Overview').setFontWeight('bold').setHorizontalAlignment('left').setWrap(true);
  arial(sh.getRange('B2'), 8).setValue(' NAME:').setFontWeight('bold').setHorizontalAlignment('left');
  arial(sh.getRange('B3'), 16).setValue('PROJECT NAME ATPU').setFontWeight('bold')
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.getRange('B4').setValue(projectName).setFontSize(16).setFontWeight('bold');
  T.STATUS.forEach(function (s, i) {
    var row = 2 + i;
    arial(sh.getRange(row, 7, 1, 2), 10)
      .setValues([[s.label, '=COUNTIF(H9:H' + s.countTo + ',"' + s.label + '")']])
      .setBackground(s.fill).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.getRange(row, 7).setFontWeight('bold').setFontColor(s.text);
    sh.getRange(row, 9).setValue(s.label); // sumber dropdown kolom H
  });
  sh.getRange('G2:H4').setBorder(true, true, true, true, true, true);
  sh.getRange('G5:H5').setBorder(true, true, true, false, true, false); // asli: H5 tanpa garis kanan
  arial(sh.getRange('D5'), 9).setValue('Total tasks:').setFontWeight('bold')
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setWrap(true);
  arial(sh.getRange('F5'), 12).setFormula('=COUNT(B9:B204)-3').setNumberFormat('0')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // Baris 6–7: pita judul abu-abu
  arial(sh.getRange('B6:K7'), 11).setBackground(T.GRAY).setFontWeight('bold');
  sh.getRange('B6').setFormula(T.TITLE_FORMULA);
  sh.getRange('B6:G6').merge().setBorder(true, true, true, true, null, null);
  sh.getRange('H6:J6').setBorder(true, true, true, true, false, null);
  sh.getRange('K6').setBorder(true, true, true, null, null, null);
  sh.getRange('B7').setBorder(null, true, null, null, null, null);
  sh.getRange('G7').setBorder(null, null, null, true, null, null);
  sh.getRange('H7').setBorder(null, true, null, null, null, null);
  sh.getRange('J7:K7').setBorder(null, null, null, true, true, null);

  // Baris 8: header hijau
  arial(sh.getRange(ROW.HEADER, COL.NO, 1, T.HEADERS.length), 11).setValues([T.HEADERS])
    .setBackground(T.GREEN).setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);
  sh.getRange('C8').setFontFamily(T.FONT).setFontColor('#000000');
  sh.getRange('F8:G8').setFontFamily(T.FONT);
  sh.getRange('B8:C8').setVerticalAlignment('middle');
  sh.getRange('D8:I8').setWrap(true);

  // Baris data 9–35
  var n = T.LAST_ROW - ROW.HEADER;
  sh.getRange(ROW.DATA_START, COL.NO, n, T.DATA_COLS.length)
    .setBorder(true, true, true, true, true, true).setVerticalAlignment('middle');
  T.DATA_COLS.forEach(function (c, i) {
    sh.getRange(ROW.DATA_START, COL.NO + i, n, 1).setFontSize(c[0]).setHorizontalAlignment(c[1]).setWrap(c[2]);
  });
  sh.getRange(ROW.DATA_START, COL.END_TIME, n, 1).setNumberFormat(FORMAT.END_TIME);
  var numbers = [];
  for (var k = 1; k <= T.NUMBERED; k++) numbers.push([k]);
  sh.getRange(ROW.DATA_START, COL.NO, T.NUMBERED, 1).setValues(numbers);

  var h = sh.getRange(ROW.DATA_START, COL.DISCIPLINE, n, 1);
  h.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange('I2:I5'), true).setAllowInvalid(false).build());
  sh.setConditionalFormatRules(Object.keys(T.CF_COLORS).map(function (v) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(v)
      .setBackground(T.CF_COLORS[v]).setRanges([h]).build();
  }));
}

/**
 * Judul B6 membaca MAX(Revision_History!B5:B30). Kalau sheet itu belum ada, buat dengan format
 * aslinya, tapi HANYA header: riwayat revisi manajer tidak disalin (judul jadi "REV 0").
 */
function ensureRevisionSheet_(ss) {
  if (ss.getSheetByName(TEMPLATE.REVISION_SHEET)) return false;
  var sh = ss.insertSheet(TEMPLATE.REVISION_SHEET, 0);
  sh.getRange(1, 1, 30, 6).setFontFamily(TEMPLATE.FONT).setFontSize(11);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(4);
  [[3, 80], [4, 98], [5, 144]].forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  sh.setRowHeight(4, 37);
  sh.getRange('B2').setValue('Document Revision History').setFontWeight('bold');
  sh.getRange('B4:E4').setValues([['Revision No.', 'Date', 'Revised By', 'Revision Comments']])
    .setFontWeight('bold').setBackground('#C6D9F1');
  sh.getRange('B4:E30').setBorder(true, true, true, true, true, true).setHorizontalAlignment('center');
  sh.getRange('E5:E30').setHorizontalAlignment('left');
  sh.getRange('B5:B30').setNumberFormat('0');
  sh.getRange('C5:C30').setNumberFormat('mm-dd-yy');
  return true;
}

// ======================= Complete.gs =======================

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

// ======================= Ui.gs =======================

/**
 * Entry point: menu spreadsheet, dialog, dan web app. Keduanya memakai halaman yang sama (Index).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WeChat Import')
    .addItem('Import laporan WeChat…', 'showImportDialog')
    .addItem('Lengkapi Root Cause / Solution…', 'showCompleteDialog')
    .addItem('Buat sheet baru (format manajer)…', 'showNewSheetDialog')
    .addItem('Terjemahkan sel terpilih (中文 + English)', 'translateSelection')
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

  ok('Versi kode: ' + APP_VERSION);

  var tz = Session.getScriptTimeZone();
  var oldTz = ss.getSpreadsheetTimeZone();
  if (oldTz !== tz) {
    ss.setSpreadsheetTimeZone(tz);
    ok('Timezone spreadsheet diubah: ' + oldTz + ' → ' + tz);
  } else {
    ok('Timezone spreadsheet: ' + tz);
  }

  if (TRANSLATE) {
    ok('Panggilan Google Translate hari ini: ' + translateCallsToday_() + ' (kuota akun Gmail ±5.000/hari; diulang dari cache tidak dihitung)');
    try {
      var en = translateTexts_(['mesin macet'], 'id', 'en');
      ok('Terjemahan aktif: "mesin macet" → "' + fixZh_(translateTexts_(en, 'en', 'zh-CN')[0]) + '" (' + en[0] + ')');
    } catch (e) {
      bad('Terjemahan gagal: ' + (e.message || e) + '. Impor masih bisa tanpa terjemahan.');
    }
  }

  var sheets = issueSheetNames_(ss);
  if (sheets.length) ok('Sheet issue (header baris ' + ROW.HEADER + '): ' + sheets.join(', '));
  else bad('Tidak ada sheet dengan header ' + HEADER_CHECK.join(' | ') + ' di baris ' + ROW.HEADER + '. Buat lewat menu WeChat Import → Buat sheet baru.');

  var routes = projectRoutes_(ss);
  Object.keys(routes).forEach(function (p) {
    var name = routes[p];
    if (sheets.indexOf(name) !== -1) ok('Proyek ' + p + ' → "' + name + '"');
    else bad('Proyek ' + p + ' → "' + name + '" tidak ditemukan / bukan sheet issue. Buat lewat menu "Buat sheet baru" dengan kode ' + p + ', atau ubah PROJECT_SHEET di Config.');
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

function showCompleteDialog() {
  SpreadsheetApp.getUi().showModalDialog(page_('complete').setWidth(1100).setHeight(760), APP_NAME + ': Lengkapi');
}

function showNewSheetDialog() {
  SpreadsheetApp.getUi().showModalDialog(page_('newsheet').setWidth(560).setHeight(600), 'Buat sheet baru');
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
 * (dari menu), selain itu sheet issue pertama yang bukan tujuan rute proyek (web app
 * tidak punya "sheet aktif").
 */
function getInitData() {
  var ss = ss_();
  var sheets = issueSheetNames_(ss);
  var routes = projectRoutes_(ss);
  var reserved = Object.keys(routes).map(function (k) { return routes[k]; });
  var free = sheets.filter(function (n) { return reserved.indexOf(n) === -1; });
  var active = ss.getActiveSheet().getName();
  return {
    appName: APP_NAME,
    spreadsheetName: ss.getName(),
    url: ss.getUrl(),
    sheets: sheets,
    defaultOther: free.indexOf(active) !== -1 ? active : (free[0] || sheets[0] || ''),
    projectSheets: Object.keys(routes).map(function (k) {
      return { project: k, sheet: routes[k], ok: sheets.indexOf(routes[k]) !== -1 };
    }),
    disciplines: DISCIPLINES,
    headerRow: ROW.HEADER,
    version: APP_VERSION
  };
}
