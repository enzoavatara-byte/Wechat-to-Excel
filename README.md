# WeChat Import

Mengubah laporan masalah produksi dari grup WeChat (format ①–⑨) menjadi baris di spreadsheet
**Statistical Analysis of Issues Reported from Production**. Google Apps Script + Google Sheets.
Kode di-paste manual ke editor Apps Script (tanpa clasp).

```
PASTE teks WeChat → PERIKSA (centang, pilih Discipline) → IMPOR → lengkapi sel kuning (tanya mentor)
```

![Layar Periksa](docs/screenshot.png)

---

## 1. Struktur

| File | Isi |
|---|---|
| `src/Config.gs` | **Semua** konfigurasi: sheet per proyek, `DISCIPLINE_MAP`, jenis yang dilewati, kolom, warna, format |
| `src/Parser.gs` | Fungsi murni (tanpa `SpreadsheetApp`): `parseReports`, `parseOne`, `parseDateTime`, pemetaan ke kolom |
| `src/Sheet.gs` | `findNextRow`, `writeRecord`, `previewWeChat`, `importWeChat`, pengaman sheet, deteksi duplikat |
| `src/Ui.gs` | `onOpen` (menu), `showImportDialog`, `doGet` (web app), `getInitData` |
| `src/Index.html`, `App.html`, `Styles.html` | UI: satu halaman, 3 langkah. Dipakai di dialog menu **dan** web app |
| `src/appsscript.json` | Manifest: timezone `Asia/Shanghai`, runtime V8, izin minimum |
| `test/` | Test Node tanpa Google: parser + penulisan sheet dengan mock |

---

## 2. Setup pertama kali (±15 menit)

> **Coba dulu di salinan** (File → *Make a copy*), bukan langsung di file manajer.

1. **Convert .xlsx ke Google Sheets.** Upload file ke Google Drive → buka → **File → Save as Google Sheets**.
   Kerjakan di file Google Sheets hasilnya. (File .xlsx yang dibuka langsung masih "Office mode",
   menu Extensions → Apps Script tidak tersedia.)
2. **Timezone spreadsheet:** File → Settings → Time zone → **(GMT+08:00) China Standard Time** (`Asia/Shanghai`).
   Catatan: tool menulis tanggal & jam sebagai nomor seri, jadi hasilnya tidak bergeser walau timezone berbeda.
   Setting ini hanya supaya sama dengan manifest.
3. Di spreadsheet itu: **Extensions → Apps Script**. Hapus isi `Code.gs` bawaan (atau hapus file-nya).
4. Buat file sesuai folder `src/`, **nama persis sama tanpa ekstensi**, lalu copy-paste isinya:
   - **+ → Script**: `Config`, `Parser`, `Sheet`, `Ui`
   - **+ → HTML**: `Index`, `App`, `Styles`
5. **Project Settings** (ikon gerigi) → centang **Show "appsscript.json" manifest file in editor** →
   kembali ke Editor, ganti isi `appsscript.json` dengan `src/appsscript.json`. Simpan (Ctrl+S).
6. Reload tab spreadsheet → menu **WeChat Import** muncul di menu bar.
7. Klik **WeChat Import → Import laporan WeChat…**. Pertama kali, Google meminta izin:
   Continue → pilih akun → *"Google hasn't verified this app"* → Advanced → Go to … (unsafe) → Allow.
   Lalu klik menunya sekali lagi. Izin yang diminta hanya: spreadsheet **ini** saja + menampilkan dialog.
   (Alternatif: di editor, buka file `Ui` → pilih fungsi `getInitData` → **Run**.)
8. *(Opsional)* **Web app**: Deploy → **New deployment** → ⚙ **Web app** →
   Execute as: **Me** · Who has access: **Only myself** → Deploy → salin URL berakhiran `/exec`, bookmark.

### Update kode
- Paste ulang file yang berubah → Simpan. Menu/dialog langsung memakai kode baru.
- Web app: **Deploy → Manage deployments** → ikon pensil → Version: **New version** → Deploy.
  Jangan "New deployment" (URL-nya berubah).

---

## 3. Cara pakai

1. Di WeChat, copy laporan. Boleh beberapa sekaligus; teks obrolan lain di sela-selanya diabaikan.
2. Spreadsheet → **WeChat Import → Import laporan WeChat…** (atau buka URL web app).
3. Paste → **Proses laporan** (Ctrl+Enter).
4. **Periksa** setiap kartu:
   - Centang = akan ditulis. **Change over default tidak dicentang** (lihat bagian 6).
   - Laporan yang sudah ada di sheet ditandai **"sudah ada: … baris N"** dan tidak dicentang.
   - Discipline bisa dipilih manual; kosong = sel H kuning.
   - Peringatan kuning menunjukkan field yang gagal terbaca + kolom yang terdampak.
5. **Impor N laporan.**
6. Halaman **Selesai**: link langsung ke tiap baris, dan **Pertanyaan untuk mentor** (tombol *Salin*)
   berisi Root Cause, Solusi, dan semua sel kuning lain per laporan, siap dikirim.
7. Setelah dapat jawaban, isi sel kuning lalu hapus warnanya (Fill color → None).

---

## 4. Aturan pemetaan

| Kolom | Isi |
|---|---|
| **B** No.序号 (*xùhào*, nomor urut) | Kalau sudah ada nomor, tidak diubah. Kalau kosong: nomor terbesar di atasnya + 1 |
| **C** Machine | `② - ③`, mis. `E245 - Finishing`. Ditulis apa adanya (`finishing` tetap huruf kecil) |
| **D** Issue Description | ⑤ (multi-baris dipertahankan) |
| **E** Root Cause, **F** Solution | **Selalu kosong + kuning** `#FFF2CC`. Diisi manual |
| **G** End Time | Jam dari ⑧, format `h:mm` |
| **H** Discipline | ⑥-1 lewat `DISCIPLINE_MAP` (huruf besar/kecil, spasi, strip diabaikan). Tidak terpetakan → kosong + kuning + peringatan |
| **I** Responsibility | ⑥-2 tanpa `@`, digabung `", "` |
| **J** Date | Tanggal dari ④, format `yyyy/mm/dd` |
| **K** Notes | Level ①, jam mulai ④, durasi, jenis asli ⑥-1, ⑦-1, ⑦-2, lalu satu baris `⚠` per peringatan |

- **Sheet tujuan:** proyek di `PROJECT_SHEET` (E245 → `Geely list (2)`); proyek lain → sheet yang dipilih di UI.
- **Baris tujuan:** baris pertama mulai baris 9 yang **C dan D-nya kosong**.
- **Urutan:** dari jam kejadian (tanggal + jam ④) paling awal. Laporan tanpa ④ yang valid ditaruh paling akhir.
- **Durasi** selalu dihitung ulang dari ④ → ⑧. Kalau beda dengan ⑨ → peringatan. Lewat tengah malam ditangani.
- Teks di C/D/I yang diawali `=` `+` `-` `@` atau mirip angka diberi awalan `'` (tidak terlihat), supaya
  Sheets tidak membacanya sebagai rumus. Contoh: deskripsi berpoin `- lem habis` tanpa ini jadi `#ERROR!`.

Contoh Notes:
```
Level: L1 | Mulai: 18:05 | Durasi: 18 menit | Jenis: Change over | Lini: Mesin pulih | Penanganan: Selesai penanganan
⚠ ⑥-1 jenis "Change over" belum dipetakan ke Discipline
```

### Ketahanan parser
Parsing dikunci pada **simbol** ①–⑨ dan ⑥-1/⑥-2, ⑦-1/⑦-2, bukan teks labelnya. Tahan terhadap:
spasi tidak konsisten (`2026.10.20/ 21:24`), `:` atau `：`, angka/tanda baca full-width, huruf besar/kecil,
⑨ dengan/tanpa "menit", baris diawali spasi, CRLF, spasi khusus @mention WeChat, beberapa laporan sekaligus,
laporan yang lupa menulis ①, dan `⑥` tanpa `-1/-2`. Jam boleh `18:05` atau `18.05`.

### Jangan mengarang data
Field yang gagal terbaca **dikosongkan + kuning**, dan teks aslinya dicatat di Notes. Khususnya:
- Tanggal hanya dibaca kalau **tahun.bulan.tanggal**. `20/10/2026` ditolak (DD/MM vs MM/DD ambigu); `26.10.20` ditolak (tahun 2 digit).
- Field teks tanpa `:` ditolak (label & isi tidak bisa dipisah dengan pasti).
- ⑧ tanpa tanggal → durasi tidak dihitung (tidak diasumsikan hari yang sama).
- Laporan tanpa Machine **dan** Deskripsi tidak ditulis (baris itu akan dianggap kosong dan tertimpa impor berikutnya).

---

## 5. Konfigurasi (`src/Config.gs`)

| Nama | Gunanya |
|---|---|
| `PROJECT_SHEET` | Proyek → sheet. Kunci huruf besar tanpa spasi/strip (`'E245'`) |
| `DISCIPLINE_MAP` | Jenis ⑥-1 → Discipline. **Tambahkan hanya yang sudah pasti** |
| `SKIP_TYPES` | Jenis ⑥-1 yang default tidak dicentang (`'changeover'`) |
| `DISCIPLINES` | Harus sama persis dengan dropdown di sheet (`I2:I5`) |
| `HEADER_CHECK` | Teks awal B8, C8, D8. Sheet lain tidak akan pernah ditulisi |
| `ROW`, `COL`, `COLOR`, `FORMAT` | Posisi header/data, nomor kolom, warna kuning, format G/J |

---

## 6. Keputusan yang belum dibuat

1. **"Change over" masuk Discipline apa?** Belum diputuskan → baris di `DISCIPLINE_MAP` masih dikomentari.
   Sesuai instruksi terakhir, change over (mis. pergantian lem) **default tidak diimpor**: tetap tampil di
   layar Periksa tapi tidak dicentang. Kalau dicentang manual, H kosong + kuning, kecuali Discipline dipilih.
   Setelah diputuskan: aktifkan baris di `DISCIPLINE_MAP`, dan hapus `'changeover'` dari `SKIP_TYPES` kalau
   memang harus ikut diimpor.
2. **Bahasa.** Sheet manajer berformat 中文 (*zhōngwén*, bahasa Mandarin) + (English); input operator Bahasa
   Indonesia. Tool menulis apa adanya, **tidak ada fitur terjemahan**.

---

## 7. Batasan & risiko (baca sebelum dipakai)

1. **Label dari operator dipercaya apa adanya.** Contoh nyata di data uji: laporan 19:15 berlabel *Change over*,
   isinya *"mesin lem upper pack stuck saat peroses pengeleman"* (mesin macet 12 menit). Laporan itu ikut
   **tidak dicentang**. Selalu baca kartu "default tidak diimpor" sebelum menekan Impor.
2. **Deteksi duplikat** membandingkan Machine + Deskripsi + End Time + Date di sheet. Kalau baris sudah diedit
   (mis. D diterjemahkan), paste ulang chat yang sama **tidak** terdeteksi sebagai duplikat.
3. **Dropdown H** di file asli hanya ada di `H9:H35`. Mulai baris 36 tidak ada dropdown. Tool tetap menulis
   nilai yang valid, tapi tidak menambah validasi ke sheet manajer.
4. **`LImo 7 list` baris 15–17**: J sudah berisi tanggal tapi C & D kosong → dianggap baris kosong; J akan
   ditimpa tanggal laporan.
5. **Kolom J baris lama** tersimpan sebagai angka berformat *General* (tampil `46313`). Baris dari tool tampil
   `2026/10/20`. Tool tidak mengubah baris lama.
6. **F5 "Total tasks"** = `COUNT(B9:B204)-3` menghitung nomor yang sudah diisi di muka (sekarang 11, padahal
   isinya 9). Itu rumus sheet manajer, bukan dari tool.
7. **Web app "Only myself"**: hanya pemilik yang bisa membuka. Kalau orang lain perlu memakainya, mereka butuh
   akses Editor ke spreadsheet + deployment *Execute as: User accessing*, dengan risiko yang sama seperti proyek MTTR.

---

## 8. Troubleshooting

| Gejala | Penyebab paling mungkin | Solusi |
|---|---|---|
| Menu **WeChat Import** tidak muncul | Tab belum di-reload setelah paste kode, atau `onOpen` salah ketik | Reload tab spreadsheet; pastikan file `Ui` berisi fungsi `onOpen` |
| "Tidak ada sheet dengan header di baris 8" | Header B8:D8 berubah, atau script dibuat bukan dari spreadsheet ini | Cek B8 = `No.序号`, C8 = `Machine`, D8 = `Issue Description…`; buat script lewat Extensions → Apps Script di spreadsheet yang benar |
| "Sheet "Geely list (2)" tidak ditemukan" | Nama sheet berubah | Sesuaikan `PROJECT_SHEET` di `Config.gs` |
| "…violates the data validation rules" di H | `DISCIPLINES` ≠ isi dropdown `I2:I5` | Samakan persis (huruf besar/kecil & spasi) |
| "Tidak ada laporan terdeteksi" | Simbol ①–⑨ hilang (mis. teks hasil OCR/screenshot) | Copy teks asli dari WeChat |
| Tanggal tampil sebagai angka | Format sel J diubah | Format → Number → Custom: `yyyy/mm/dd` |
| "Masih ada impor lain yang berjalan" | Dua impor bersamaan | Tunggu beberapa detik, coba lagi |
| Error lain | – | Editor Apps Script → **Executions** untuk stack trace |

---

## 9. Test

```bash
npm test     # node --test test/*.test.js (Node 18+), tanpa dependency
```

- `test/parser.test.js`: 5 laporan asli di `test/fixtures/sample.txt` + kasus rusak (field hilang, tanggal
  salah, tanpa `:`, teks tanpa ①–⑨, ⑨ beda, ⑧ < ④, lewat tengah malam, duplikat).
- `test/sheet.test.js`: penulisan dengan mock Sheets yang meniru file manajer (baris tujuan, nomor B,
  kuning, pengaman sheet, duplikat, urutan tulis).

Hasil yang diharapkan dari fixture:

| ④ | ⑧ | Durasi | ⑥-1 → H | Default |
|---|---|---|---|---|
| 17:20 (`17.20`) | 17:40 | 20 | Change over → kosong + ⚠ | tidak diimpor |
| 18:05 | 18:23 | 18 | Change over → kosong + ⚠ | tidak diimpor |
| 19:15 | 19:27 | 12 | Change over → kosong + ⚠ | tidak diimpor |
| 20:15 | 20:23 | 8 | Mesin → Machine | diimpor |
| 21:24 | 21:40 | 16 | mesin → Machine | diimpor |

Tidak ada selisih ⑨. PIC 18:05 = `iqbal, M Arif Rahman, Muhamad gilang`.

**Tidak** diuji otomatis: perilaku asli Google (izin, validasi dropdown, tampilan dialog). Cek manual sekali
setelah setup: impor fixture ke **salinan** spreadsheet dan bandingkan dengan tabel di atas.

---

## 10. Deviasi dari brief awal (sengaja)

| Brief | Implementasi | Alasan |
|---|---|---|
| `Code.gs` direfaktor | Ditulis baru | `Code.gs` tidak ada di repo mana pun |
| clasp + `src/Dialog.html` | Paste manual; UI web app **dan** dialog menu dari file yang sama | Permintaan terbaru: tanpa koneksi langsung, paste seperti proyek MTTR |
| Ekspektasi 18:05, 19:15, 20:15, **20:30**, 21:24; durasi 18, 12, 8, **13**, 16 | 17:20, 18:05, 19:15, 20:15, 21:24; durasi 20, 18, 12, 8, 16 | Laporan 20:30/13 menit tidak ada di teks yang diberikan. Ekspektasi diturunkan dari data, bukan dikarang |
| Change over ditulis dengan Discipline kosong | Tampil, **default tidak dicentang** | Instruksi terakhir: "changeover seperti pergantian lem tidak perlu dimasukkan". Tetap tampil karena ada yang salah label (19:15) |
| Proyek lain → sheet aktif | Dropdown "Sheet untuk proyek lain" (default: sheet aktif kalau valid) | Web app tidak punya sheet aktif; mencegah data masuk ke `Revision_History` |
| – | Deteksi duplikat | Paste ulang chat yang sama adalah kesalahan yang paling mungkin terjadi |
| – | "Pertanyaan untuk mentor" | Alur kerja nyata: data yang kurang ditanyakan ke mentor |
| – | `test/sheet.test.js` | Penulisan ke sheet adalah bagian yang bisa merusak file manajer |
