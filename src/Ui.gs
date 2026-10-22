/**
 * Entry point: menu spreadsheet, dialog, dan web app. Keduanya memakai halaman yang sama (Index).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WeChat Import')
    .addItem('Import laporan WeChat…', 'showImportDialog')
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

  var tz = Session.getScriptTimeZone();
  var oldTz = ss.getSpreadsheetTimeZone();
  if (oldTz !== tz) {
    ss.setSpreadsheetTimeZone(tz);
    ok('Timezone spreadsheet diubah: ' + oldTz + ' → ' + tz);
  } else {
    ok('Timezone spreadsheet: ' + tz);
  }

  if (TRANSLATE) {
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
    headerRow: ROW.HEADER
  };
}
