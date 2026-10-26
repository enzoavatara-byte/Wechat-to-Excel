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
