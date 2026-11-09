/**
 * Halaman Ringkasan (beranda web app): semua baris issue (C atau D terisi) dari semua sheet issue,
 * dalam bentuk ringkas untuk heatmap, kartu angka, dan riwayat. Statistik dihitung di browser.
 */
function getDashboard() {
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
      rows.push({
        sheet: r.sheet,
        sheetId: r.sheetId,
        row: r.row,
        no: r.no,
        date: r.date,
        start: r.start,
        end: r.end,
        downtime: r.downtime,
        process: r.process,
        machine: r.machineOrig || r.machine,
        problem: r.descOrig || r.description,
        pic: r.pic,
        complete: !isEmpty_(r.rootCause) && !isEmpty_(r.solution),
        need: r.need.map(function (n) { return n.col; })
      });
    });
  });
  return { rows: rows, url: ss.getUrl(), spreadsheetName: ss.getName(), version: APP_VERSION };
}
