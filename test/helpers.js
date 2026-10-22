/**
 * Memuat file src/*.gs ke satu context Node, seperti Apps Script:
 * semua file berbagi global scope dan dimuat berurutan.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function loadGas(files, globals) {
  const ctx = vm.createContext(Object.assign({ console }, globals || {}));
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

/** Objek dari context vm punya prototype berbeda; ubah ke objek biasa untuk deepStrictEqual. */
function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

module.exports = { loadGas, plain, readFixture };
