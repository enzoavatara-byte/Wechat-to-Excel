/**
 * Mock minimal SpreadsheetApp untuk test Sheet.gs/Ui.gs tanpa Google.
 * getDisplayValues meniru format "h:mm" dan "yyyy/mm/dd" yang dipakai tool ini.
 */
'use strict';

const pad = (n) => String(n).padStart(2, '0');

function display(v, fmt) {
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
  getValues() { return this.grid((x) => (x.v === undefined ? '' : x.v)); }
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
}

class MockSheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.cells = new Map();
    this.writes = 0;
  }
  cell(r, c) {
    const k = r + ',' + c;
    if (!this.cells.has(k)) this.cells.set(k, {});
    return this.cells.get(k);
  }
  get(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).v; }
  bg(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).bg; }
  fmt(a1) { const [r, c] = parseA1(a1); return this.cell(r, c).f; }
  set(a1, v) { const [r, c] = parseA1(a1); this.cell(r, c).v = v; return this; }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastRow() {
    let last = 0;
    for (const [k, x] of this.cells) if (x.v !== undefined && x.v !== '') last = Math.max(last, Number(k.split(',')[0]));
    return last;
  }
  getRange(r, c, nr, nc) { return new MockRange(this, r, c, nr, nc); }
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
  }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getActiveSheet() { return this.sheets[this.active]; }
}

function services(ss) {
  return {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
  };
}

const HEADER = ['No.序号', 'Machine', 'Issue Description \n问题描述', '原因分析', '解决方案', '解决时间',
  'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes'];

function issueSheet(name, id, filledRows, numberedTo) {
  const sh = new MockSheet(name, id);
  sh.set('B6', 'ASSEMBLY & UPFIT PALLET PRE-ACCEPTANCE CHECKLIST');
  HEADER.forEach((h, i) => sh.cell(8, 2 + i).v = h);
  for (let n = 1; n <= numberedTo; n++) sh.cell(8 + n, 2).v = n;
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
