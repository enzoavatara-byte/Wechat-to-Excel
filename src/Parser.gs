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
