/**
 * Mock minimal SpreadsheetApp untuk test Sheet.gs/Template.gs/Ui.gs tanpa Google.
 * getDisplayValues meniru format "h:mm" dan "yyyy/mm/dd" yang dipakai tool ini.
 * Format (font, rata, wrap, border, merge, lebar/tinggi) hanya dicatat untuk diperiksa test.
 */
'use strict';
const crypto = require('crypto');

const pad = (n) => String(n).padStart(2, '0');

// Seperti Sheets: awalan ' memaksa teks dan tidak ikut terbaca.
const unquote = (v) => (typeof v === 'string' && v[0] === "'" ? v.slice(1) : v);

function display(v, fmt) {
  v = unquote(v);
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number' && fmt === 'h:mm') {
    const min = Math.round(v * 1440) % 1440;
    return Math.floor(min / 60) + ':' + pad(min % 60);
  }
  if (typeof v === 'number' && fmt === 'yyyy/mm/dd') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate());
  }
  return String(v);
}

function parseA1(a1) {
  const m = /^([A-Z])(\d+)$/.exec(a1);
  if (!m) throw new Error('A1 tidak didukung mock: ' + a1);
  return [Number(m[2]), m[1].charCodeAt(0) - 64];
}

/** "B6:G6" atau "A1" -> [row, col, numRows, numCols] */
function parseRange(a1) {
  const [from, to] = a1.split(':');
  const [r1, c1] = parseA1(from);
  const [r2, c2] = to ? parseA1(to) : [r1, c1];
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

const a1Of = (r, c) => String.fromCharCode(64 + c) + r;

class MockRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr: nr || 1, nc: nc || 1 });
  }
  each(fn) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.row + i, this.col + j, i, j);
  }
  grid(fn) {
    const out = Array.from({ length: this.nr }, () => new Array(this.nc));
    this.each((r, c, i, j) => { out[i][j] = fn(this.sheet.cell(r, c)); });
    return out;
  }
  getValues() { return this.grid((x) => (x.v === undefined ? '' : unquote(x.v))); }
  getDisplayValues() { return this.grid((x) => this.sheet.evaluate(x) ?? display(x.v, x.f)); }
  setFormulas(f) { return this.setValues(f); }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('Ukuran setValues tidak cocok');
    // Seperti Google: dropdown "reject input" menolak nilai di luar daftar (seluruh panggilan gagal).
    this.each((r, c, i, j) => {
      const rule = this.sheet.validations.get(r + ',' + c);
      const val = unquote(v[i][j]);
      if (!rule || rule.allowInvalid || val === '' || val === null || val === undefined) return;
      const allowed = [].concat(...rule.getCriteriaValues()[0].getDisplayValues());
      if (allowed.indexOf(String(val)) === -1) {
        throw new Error('The data you entered in cell ' + a1Of(r, c) + ' violates the data validation rules set on this cell.');
      }
    });
    this.each((r, c, i, j) => { this.sheet.cell(r, c).v = v[i][j]; });
    this.sheet.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) { this.each((r, c) => { this.sheet.cell(r, c).f = f; }); return this; }
  setBackground(bg) { this.each((r, c) => { this.sheet.cell(r, c).bg = bg; }); return this; }
  getDataValidation() { return this.sheet.validations.get(this.row + ',' + this.col) || null; }
  getNotes() { return this.grid((x) => x.note || ''); }
  getDataValidations() { const out = this.grid(() => null); this.each((r, c, i, j) => { out[i][j] = this.sheet.validations.get(r + ',' + c) || null; }); return out; }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getA1Notation() { return this.a1(); }
  setNotes(n) { this.each((r, c, i, j) => { this.sheet.cell(r, c).note = n[i][j]; }); return this; }
  setNote(n) { return this.setNotes([[n]]); }
  getFormulas() { return this.grid((x) => (typeof x.v === 'string' && x.v[0] === '=' ? x.v : '')); }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getCell(i, j) { return new MockRange(this.sheet, this.row + i - 1, this.col + j - 1); }
  setDataValidation(rule) { this.each((r, c) => { this.sheet.validations.set(r + ',' + c, rule); }); return this; }
  setFormula(f) { return this.setValue(f); }
  style(key, v) { this.each((r, c) => { const x = this.sheet.cell(r, c); x.s = Object.assign({}, x.s, { [key]: v }); }); return this; }
  setFontFamily(v) { return this.style('font', v); }
  setFontSize(v) { return this.style('size', v); }
  setFontWeight(v) { return this.style('weight', v); }
  setFontColor(v) { return this.style('color', v); }
  setHorizontalAlignment(v) { return this.style('h', v); }
  setVerticalAlignment(v) { return this.style('v', v); }
  setWrap(v) { return this.style('wrap', v); }
  setBorder(...sides) { this.sheet.borders.push([this.a1(), sides]); return this; }
  merge() { this.sheet.merges.push(this.a1()); return this; }
  a1() { return a1Of(this.row, this.col) + (this.nr * this.nc > 1 ? ':' + a1Of(this.row + this.nr - 1, this.col + this.nc - 1) : ''); }
}

class MockSheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.cells = new Map();
    this.validations = new Map();
    this.writes = 0;
    this.borders = [];
    this.merges = [];
    this.colWidths = {};
    this.rowHeights = {};
    this.meta = [];
    this.cfRules = [];
    this.props = {};
  }
  cell(r, c) {
    const k = r + ',' + c;
    if (!this.cells.has(k)) this.cells.set(k, {});
    return this.cells.get(k);
  }
  get(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).v; }
  bg(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).bg; }
  fmt(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).f; }
  styleOf(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).s || {}; }
  note(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).note; }
  set(a1, v) { const [r, c] = parseA1(a1); this.cell(r, c).v = v; return this; }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  hideSheet() { this.props.hidden = true; return this; }
  /** Rumus =GOOGLETRANSLATE(A1,"id","en") dihitung lewat penerjemah palsu spreadsheet (kalau ada). */
  evaluate(x) {
    const m = typeof x.v === 'string' && /^=GOOGLETRANSLATE\(([A-Z])(\d+),"([^"]+)","([^"]+)"\)$/.exec(x.v);
    if (!m || !this.ss || !this.ss.formulaTranslate) return null;
    return this.ss.formulaTranslate(unquote(this.get(m[1] + m[2])), m[3], m[4]);
  }
  getLastRow() {
    let last = 0;
    for (const [k, x] of this.cells) if (x.v !== undefined && x.v !== '') last = Math.max(last, Number(k.split(',')[0]));
    return last;
  }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') [r, c, nr, nc] = parseRange(r);
    return new MockRange(this, r, c, nr, nc);
  }
  setColumnWidth(c, w) { this.colWidths[c] = w; return this; }
  setRowHeight(r, h) { this.rowHeights[r] = h; return this; }
  setHiddenGridlines(v) { this.props.hiddenGridlines = v; return this; }
  setTabColor(v) { this.props.tabColor = v; return this; }
  setFrozenRows(n) { this.props.frozenRows = n; return this; }
  setConditionalFormatRules(rules) { this.cfRules = rules; }
  activate() { return this; }
  addDeveloperMetadata(key, value) { this.meta.push({ getKey: () => key, getValue: () => value }); return this; }
  getDeveloperMetadata() { return this.meta; }
  getRangeList(a1s) {
    const ranges = a1s.map((a) => { const [r, c] = parseA1(a); return new MockRange(this, r, c); });
    return { setBackground: (bg) => ranges.forEach((x) => x.setBackground(bg)) };
  }
}

class MockSpreadsheet {
  constructor(name, sheets, activeIndex) {
    this.name = name;
    this.sheets = sheets;
    this.active = activeIndex || 0;
    this.tz = 'Asia/Jakarta';
  }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getActiveSheet() { return this.sheets[this.active]; }
  insertSheet(name, index) {
    if (this.getSheetByName(name)) throw new Error('A sheet with the name "' + name + '" already exists.');
    const sh = new MockSheet(name, Math.max(0, ...this.sheets.map((s) => s.id)) + 1);
    sh.ss = this;
    this.sheets.splice(index === undefined ? this.sheets.length : index, 0, sh);
    return sh;
  }
  deleteSheet(sh) { this.sheets = this.sheets.filter((s) => s !== sh); }
}

// Penerjemah palsu pengganti LanguageApp: kamus kecil untuk teks fixture, selain itu diberi penanda
// ("EN:"/"中:") supaya hasil bisa dicek. Menjaga jumlah baris seperti Google Translate.
const DICT = {
  en: {
    'Finishing': 'Finishing', 'finishing': 'finishing', 'Press Modul': 'Module Press',
    'pergantian lem kotak B Upper modul': 'glue replacement for box B upper module',
    'pergantian lem kotak A': 'glue replacement for box A',
    'mesin lem upper pack stuck saat peroses pengeleman': 'upper pack gluing machine stuck during the gluing process',
    'Posisi nozzle tidak masuk pada pallet': 'Nozzle position does not enter the pallet',
    'mesin lem upper pack stuck': 'upper pack gluing machine stuck',
    'mesin macet': 'machine jammed'
  },
  'zh-CN': {
    'Finishing': '精加工', 'finishing': '精加工', 'Module Press': '模块压装',
    'glue replacement for box B upper module': 'B盒上部模块换胶',
    'Nozzle position does not enter the pallet': '喷嘴位置未进入托盘',
    'upper pack gluing machine stuck': '上包涂胶机卡住',
    'machine jammed': '机器卡住'
  }
};

function fakeWord(l, to) {
  return (DICT[to] && DICT[to][l]) || (to === 'en' ? 'EN:' + l : '中:' + l);
}

function fakeLanguageApp() {
  const app = {
    calls: [],
    fail: false,       // kuota harian habis
    failRate: 0,       // n panggilan berikutnya kena batas per menit
    mergeLines: false, // mode teks menggabung baris (mode HTML tetap rapi)
    translate(text, from, to, args) {
      app.calls.push({ text, from, to, html: !!(args && args.contentType === 'html') });
      if (app.fail) throw new Error('Service invoked too many times for one day: translate.');
      if (app.failRate > 0) { app.failRate--; throw new Error('Service invoked too many times in a short time: translate. Try Utilities.sleep(1000) between calls.'); }
      if (args && args.contentType === 'html') {
        return String(text).replace(/<p>([\s\S]*?)<\/p>/g, (m, inner) => {
          const plainText = inner.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          return '<p>' + fakeWord(plainText, to).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
        });
      }
      const out = String(text).split('\n').map((l) => fakeWord(l, to));
      return app.mergeLines && out.length > 1 ? out.join(' ') : out.join('\n');
    }
  };
  return app;
}

function fakeCache() {
  const store = new Map();
  return {
    store,
    getAll(keys) { const o = {}; keys.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; },
    putAll(vals) { Object.keys(vals).forEach((k) => store.set(k, vals[k])); }
  };
}

function fakeProps() {
  const p = new Map();
  return { getProperty: (k) => (p.has(k) ? p.get(k) : null), setProperty(k, v) { p.set(k, String(v)); return this; } };
}

function services(ss) {
  const cache = fakeCache();
  const props = fakeProps();
  const sleeps = [];
  // Rumus GOOGLETRANSLATE: kuota terpisah dari LanguageApp.
  ss.formulaCalls = [];
  ss.formulaFail = false;
  ss.formulaTranslate = (text, from, to) => {
    ss.formulaCalls.push({ text, from, to });
    return ss.formulaFail ? '#VALUE!' : fakeWord(text, to);
  };
  ss.sheets.forEach((sh) => { sh.ss = ss; });
  return {
    LanguageApp: fakeLanguageApp(),
    CacheService: { getScriptCache: () => cache, cache },
    PropertiesService: { getScriptProperties: () => props },
    Utilities: {
      sleeps,
      sleep(ms) { sleeps.push(ms); },
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest(alg, text) { return Array.from(crypto.createHash('md5').update(String(text), 'utf8').digest()); },
      base64Encode(bytes) { return Buffer.from(bytes.map((b) => b & 255)).toString('base64'); }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActiveRange: () => ss.activeRange || null,
      flush() {},
      DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', VALUE_IN_RANGE: 'VALUE_IN_RANGE' },
      newDataValidation() {
        const rule = { allowInvalid: true };
        const b = {
          requireValueInRange(range, show) { rule.type = 'VALUE_IN_RANGE'; rule.values = [range, show]; return b; },
          setAllowInvalid(v) { rule.allowInvalid = v; return b; },
          build() { return Object.assign(rule, { getCriteriaType: () => rule.type, getCriteriaValues: () => rule.values }); }
        };
        return b;
      },
      newConditionalFormatRule() {
        const rule = {};
        const b = {
          whenTextEqualTo(t) { rule.text = t; return b; },
          setBackground(c) { rule.bg = c; return b; },
          setRanges(rs) { rule.ranges = rs.map((r) => r.a1()); return b; },
          build() { return rule; }
        };
        return b;
      },
      // Seperti saat Run dari editor tanpa spreadsheet terbuka.
      getUi() { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Shanghai' }
  };
}

const HEADER = ['No.序号', 'Machine', 'Issue Description \n问题描述', '原因分析', '解决方案', '解决时间',
  'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes'];

function issueSheet(name, id, filledRows, numberedTo) {
  const sh = new MockSheet(name, id);
  sh.set('B6', 'ASSEMBLY & UPFIT PALLET PRE-ACCEPTANCE CHECKLIST');
  HEADER.forEach((h, i) => sh.cell(8, 2 + i).v = h);
  for (let n = 1; n <= numberedTo; n++) sh.cell(8 + n, 2).v = n;
  // Sumber dropdown H di file asli: I2:I5, validasi di H9:H35.
  ['Machine', 'Operation', 'Product Item', 'MES'].forEach((d, i) => { sh.cell(2 + i, 9).v = d; });
  const source = sh.getRange(2, 9, 4, 1);
  for (let r = 9; r <= 35; r++) {
    sh.validations.set(r + ',8', { getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [source, true] });
  }
  for (let n = 1; n <= filledRows; n++) {
    sh.cell(8 + n, 3).v = 'Mesin lama ' + n;
    sh.cell(8 + n, 4).v = 'Masalah lama ' + n;
    sh.cell(8 + n, 10).v = 46310;
  }
  return sh;
}

/** Meniru file manajer: Revision_History (bukan sheet issue), LImo 7 list, Geely list (2). */
function managerSpreadsheet() {
  const rev = new MockSheet('Revision_History', 1);
  rev.set('B2', 'Document Revision History').set('B4', 'Revision No.').set('C4', 'Date');
  const limo = issueSheet('LImo 7 list', 2, 6, 14);
  // Di file asli, J15:J17 sudah berisi tanggal walau C/D kosong.
  limo.set('J15', 46312).set('J16', 46312).set('J17', 46312);
  const geely = issueSheet('Geely list (2)', 3, 9, 14);
  return new MockSpreadsheet('Statistical Analysis of Issues Reported from Production', [rev, limo, geely], 0);
}

module.exports = { MockSheet, MockSpreadsheet, managerSpreadsheet, services, issueSheet };
