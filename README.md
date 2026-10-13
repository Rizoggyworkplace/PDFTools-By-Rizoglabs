# PDF Tools

Gabungkan & pisahkan PDF dan gambar (JPG/PNG/WebP) — **100% di browser, tanpa server, tanpa upload**.

## Fitur

### 🔗 Gabung
- Upload / drag & drop banyak file sekaligus (PDF, JPG, PNG, WebP)
- Susun urutan per **file** (drag kartu / tombol ▲ ▼) — urutan kartu = urutan gabung
- Expand tiap file: thumbnail per halaman, ketuk untuk ikut / tidak ikut, susun ulang (drag / ◀ ▶), **putar halaman 90°** (tombol ⟳)
- **Nama file hasil** bisa diganti
- **Kualitas hasil**: Asli (lossless) / Tinggi / Sedang / Rendah — mode lossy meraster halaman jadi gambar agar jauh lebih kecil
- **Optimalkan ukuran file** (lossless, via object streams) + info penghematan
- **Nomor halaman otomatis** (bawah-tengah / bawah-kanan)

### ✂️ Pisah
- Upload 1 PDF → pisah per **rentang custom** (mis. 1-5, 8), **tiap N halaman**, atau **tiap halaman** jadi 1 file
- Hasil diunduh sebagai 1 file ZIP

## Teknologi

- Vanilla HTML + CSS + JS, tanpa build step
- [pdf-lib@1.17.1](https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js) — rakit PDF hasil
- [pdfjs-dist@3.11.174](https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js) — render thumbnail & raster lossy
- [jszip@3.10.1](https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js) — ZIP hasil pisah
- `assets/js/pdfutil.js` — logika murni (tanpa DOM), dipakai app.js & test

## Tes

```bash
npm i pdf-lib@1.17.1
NODE_PATH=./node_modules node --test tests/merge.test.mjs
```

## Live

https://rizoggyworkplace.github.io/PDFTools-By-Rizoglabs/
