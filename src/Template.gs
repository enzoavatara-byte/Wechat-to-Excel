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
