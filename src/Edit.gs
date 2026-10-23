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
