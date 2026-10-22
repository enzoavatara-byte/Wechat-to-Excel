/**
 * Mock minimal SpreadsheetApp untuk test Sheet.gs/Template.gs/Ui.gs tanpa Google.
 * getDisplayValues meniru format "h:mm" dan "yyyy/mm/dd" yang dipakai tool ini.
 * Format (font, rata, wrap, border, merge, lebar/tinggi) hanya dicatat untuk diperiksa test.
 */
'use strict';

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
  getDisplayValues() { return this.grid((x) => display(x.v, x.f)); }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('Ukuran setValues tidak cocok');
    this.each((r, c, i, j) => { this.sheet.cell(r, c).v = v[i][j]; });
    this.sheet.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) { this.each((r, c) => { this.sheet.cell(r, c).f = f; }); return this; }
  setBackground(bg) { this.each((r, c) => { this.sheet.cell(r, c).bg = bg; }); return this; }
  getDataValidation() { return this.sheet.validations.get(this.row + ',' + this.col) || null; }
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
  set(a1, v) { const [r, c] = parseA1(a1); this.cell(r, c).v = v; return this; }
  getName() { return this.name; }
  getSheetId() { return this.id; }
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
    this.sheets.splice(index === undefined ? this.sheets.length : index, 0, sh);
    return sh;
  }
  deleteSheet(sh) { this.sheets = this.sheets.filter((s) => s !== sh); }
}

function services(ss) {
  return {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
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
