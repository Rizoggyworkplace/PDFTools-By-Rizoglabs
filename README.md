# PDF Tools

Gabungkan banyak PDF dan gambar (JPG/PNG/WebP) menjadi satu file PDF — **100% di browser, tanpa server, tanpa upload**.

## Fitur

- Upload / drag & drop banyak file sekaligus (PDF, JPG, PNG, WebP)
- Thumbnail tiap halaman (render via pdf.js)
- Ketuk halaman untuk ikut / tidak ikut digabung
- Susun ulang halaman: drag & drop (desktop) atau tombol ◀ ▶ (HP)
- Gambar otomatis jadi halaman PDF penuh
- Satu tombol **Gabung & Download**

## Teknologi

- Vanilla HTML + CSS + JS, tanpa build step
- [pdf-lib@1.17.1](https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js) — rakit PDF hasil
- [pdfjs-dist@3.11.174](https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js) — render thumbnail

## Tes

```bash
npm i pdf-lib@1.17.1
node --test tests/merge.test.mjs
```

## Live

https://rizoggyworkplace.github.io/pdf-tools/
