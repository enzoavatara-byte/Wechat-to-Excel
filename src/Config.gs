/**
 * Semua konfigurasi di satu tempat. Ubah di sini, bukan di file lain.
 * File ini juga dimuat oleh test Node, jadi JANGAN panggil layanan Google di sini.
 */
var APP_NAME = 'WeChat Import';

// Struktur sheet manajer: header di baris 8, data mulai baris 9.
var ROW = {
  HEADER: 8,
  DATA_START: 9
};

// Nomor kolom (A = 1).
var COL = {
  NO: 2,          // B  No.序号
  MACHINE: 3,     // C  Machine
  DESC: 4,        // D  Issue Description
  ROOT_CAUSE: 5,  // E  Root Cause      -> selalu kosong + kuning (isi manual)
  SOLUTION: 6,    // F  Solution        -> selalu kosong + kuning (isi manual)
  END_TIME: 7,    // G  End Time
  DISCIPLINE: 8,  // H  Discipline (dropdown)
  PIC: 9,         // I  Responsibility
  DATE: 10,       // J  Date
  NOTES: 11       // K  Notes
};

// Sheet dianggap "sheet issue" hanya jika B8, C8, D8 diawali teks ini (huruf besar/kecil diabaikan).
// Pengaman: data tidak akan pernah ditulis ke sheet lain (mis. Revision_History).
var HEADER_CHECK = ['No.', 'Machine', 'Issue Description'];

// Proyek (②) -> nama sheet tujuan. Kunci: huruf besar, tanpa spasi/strip ("e-245" -> "E245").
// Proyek yang tidak ada di sini masuk ke sheet yang dipilih di UI.
var PROJECT_SHEET = {
  'E245': 'Geely list (2)'
};

// Isi dropdown kolom H. Harus sama persis dengan daftar di sheet (I2:I5).
var DISCIPLINES = ['Machine', 'Operation', 'Product Item', 'MES'];

// Jenis masalah (⑥-1) -> Discipline (H).
// Kunci: huruf kecil, tanpa spasi/strip/garis bawah ("Change over" -> "changeover").
// Jenis yang tidak ada di sini: H dikosongkan + kuning + peringatan. Tambahkan HANYA yang sudah pasti.
var DISCIPLINE_MAP = {
  'mesin': 'Machine',
  'machine': 'Machine',
  'operation': 'Operation',
  'productitem': 'Product Item',
  'mes': 'MES'
  // 'changeover': '???',  // BELUM DIPUTUSKAN: Change over masuk Discipline apa? (lihat README)
};

// Jenis (⑥-1) yang default TIDAK dicentang saat impor (mis. pergantian lem).
// Tetap tampil di pratinjau supaya laporan yang salah label bisa dicentang manual.
var SKIP_TYPES = ['changeover'];

var COLOR = {
  YELLOW: '#FFF2CC'  // sel yang harus dilengkapi manual
};

var FORMAT = {
  END_TIME: 'h:mm',
  DATE: 'yyyy/mm/dd'
};

var LOCK_TIMEOUT_MS = 10000;
