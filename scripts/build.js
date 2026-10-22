/**
 * Gabungkan src/ menjadi file siap-paste di dist/:
 *   dist/Code.gs          = Config + Parser + Sheet + Template + Ui
 *   dist/Index.html       = Index dengan Styles & App sudah di-inline
 *   dist/appsscript.json  = salinan manifest
 * Jalankan: npm run build. Sumber kebenaran tetap src/; jangan edit dist/ langsung.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const GS_FILES = ['Config.gs', 'Parser.gs', 'Sheet.gs', 'Template.gs', 'Ui.gs'];

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');

function buildCode() {
  const head = '/**\n * WeChat Import: SEMUA kode server dalam satu file, siap paste ke Code.gs.\n' +
    ' * DIBUAT OTOMATIS dari src/ (npm run build). Jangan edit di sini; ubah src/ lalu build ulang.\n */\n';
  return head + GS_FILES.map((f) => '\n// ======================= ' + f + ' =======================\n\n' + read(f).trimEnd() + '\n').join('');
}

function buildIndex() {
  let html = read('Index.html');
  ['Styles', 'App'].forEach((name) => {
    const tag = "<?!= include('" + name + "'); ?>";
    if (!html.includes(tag)) throw new Error('Index.html tidak berisi ' + tag);
    const body = read(name + '.html').trimEnd();
    // Index dievaluasi sebagai template: isi yang di-inline tidak boleh mengandung scriptlet.
    if (body.includes('<?')) throw new Error(name + '.html mengandung "<?", tidak aman di-inline');
    html = html.replace(tag, () => body);
  });
  return '<!-- DIBUAT OTOMATIS dari src/ (npm run build). Jangan edit di sini. -->\n' + html;
}

function build() {
  return {
    'Code.gs': buildCode(),
    'Index.html': buildIndex(),
    'appsscript.json': read('appsscript.json')
  };
}

if (require.main === module) {
  fs.mkdirSync(DIST, { recursive: true });
  const out = build();
  Object.keys(out).forEach((f) => {
    fs.writeFileSync(path.join(DIST, f), out[f]);
    console.log('dist/' + f + '  (' + out[f].split('\n').length + ' baris)');
  });
}

module.exports = { build, DIST };
