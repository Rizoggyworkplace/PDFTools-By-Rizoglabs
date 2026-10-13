/* Test logika PDF Tools (jalan di node).
 * Menguji kode ASLI di assets/js/pdfutil.js (bukan replika).
 * Jalankan: NODE_PATH=/tmp/pdftest/node_modules node --test tests/merge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import pdfLib from "pdf-lib"; // namespace lengkap utk PdfUtil

const require = createRequire(import.meta.url);
const U = require("../assets/js/pdfutil.js");

// JPEG 1x1 piksel valid (untuk tes gambar -> halaman)
const JPG_1x1 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AK//Z";

async function makePdf(sizes) {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc;
}

function pageSizes(doc) {
  const out = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { width, height } = doc.getPage(i).getSize();
    out.push([Math.round(width), Math.round(height)]);
  }
  return out;
}

// Replika collectChosen() dari app.js: file berurutan -> halaman included per file.
function collectChosen(files, pages) {
  const out = [];
  for (const f of files)
    for (const p of pages)
      if (p.fileUid === f.uid && p.included) out.push(p);
  return out;
}

/* ---------- merge dasar ---------- */

test("gabung 2 PDF utuh (3 + 2 halaman = 5)", async () => {
  const a = await makePdf([[100, 100], [200, 200], [300, 300]]);
  const b = await makePdf([[400, 400], [500, 500]]);
  const aBytes = await a.save(), bBytes = await b.save();
  const chosen = [
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1 },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2 },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 3 },
    { kind: "pdf", fileUid: "B", pdfBytes: bBytes, pageNum: 1 },
    { kind: "pdf", fileUid: "B", pdfBytes: bBytes, pageNum: 2 },
  ];
  const { bytes } = await U.buildPdf(pdfLib, chosen, { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 5);
  assert.deepEqual(pageSizes(out), [[100, 100], [200, 200], [300, 300], [400, 400], [500, 500]]);
});

test("pilih subset halaman + urutan campur antar file", async () => {
  const a = await makePdf([[100, 100], [200, 200], [300, 300]]);
  const b = await makePdf([[400, 400], [500, 500]]);
  const aBytes = await a.save(), bBytes = await b.save();
  const chosen = [
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1 }, // 100x100
    { kind: "pdf", fileUid: "B", pdfBytes: bBytes, pageNum: 2 }, // 500x500
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 3 }, // 300x300
  ];
  const { bytes } = await U.buildPdf(pdfLib, chosen, { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[100, 100], [500, 500], [300, 300]]);
});

test("gambar (JPEG) menjadi satu halaman penuh", async () => {
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const { bytes } = await U.buildPdf(pdfLib, [{ kind: "img", imgDataUrl: dataUrl }], { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 1);
  const [w, h] = pageSizes(out)[0];
  assert.equal(w, 1); assert.equal(h, 1); // ukuran halaman = ukuran gambar
});

test("campuran PDF + gambar dalam satu hasil", async () => {
  const a = await makePdf([[100, 100], [200, 200]]);
  const aBytes = await a.save();
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const files = [{ uid: "X" }];
  const pages = [
    { kind: "img", fileUid: "X", imgDataUrl: dataUrl, included: true },
    { kind: "pdf", fileUid: "X", pdfBytes: aBytes, pageNum: 2, included: true },
  ];
  const { bytes } = await U.buildPdf(pdfLib, collectChosen(files, pages), { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(pageSizes(out), [[1, 1], [200, 200]]);
});

test("urutan gabung mengikuti urutan file (file B digeser ke atas)", async () => {
  const a = await makePdf([[100, 100], [200, 200]]);
  const b = await makePdf([[300, 300]]);
  const aBytes = await a.save(), bBytes = await b.save();
  const pages = [
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1, included: true },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2, included: true },
    { kind: "pdf", fileUid: "B", pdfBytes: bBytes, pageNum: 1, included: true },
  ];
  const filesReordered = [{ uid: "B" }, { uid: "A" }]; // user geser B ke atas
  const { bytes } = await U.buildPdf(pdfLib, collectChosen(filesReordered, pages), { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[300, 300], [100, 100], [200, 200]]);
});

test("exclude per halaman + gambar dihitung 1 file = 1 halaman", async () => {
  const a = await makePdf([[100, 100], [200, 200], [300, 300]]);
  const aBytes = await a.save();
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const files = [{ uid: "IMG" }, { uid: "A" }];
  const pages = [
    { kind: "img", fileUid: "IMG", imgDataUrl: dataUrl, included: true },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1, included: true },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2, included: false },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 3, included: true },
  ];
  const { bytes } = await U.buildPdf(pdfLib, collectChosen(files, pages), { optimize: true });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[1, 1], [100, 100], [300, 300]]);
});

/* ---------- nama file hasil ---------- */

test("resolveFileName: nama custom dipakai, .pdf ditambah otomatis", () => {
  assert.equal(U.resolveFileName("laporan bulanan"), "laporan bulanan.pdf");
  assert.equal(U.resolveFileName("laporan.pdf"), "laporan.pdf");
  assert.equal(U.resolveFileName("LAPORAN.PDF"), "LAPORAN.PDF");
  assert.equal(U.resolveFileName("  spasi  "), "spasi.pdf");
});

test("resolveFileName: sanitasi karakter ilegal & fallback default", () => {
  assert.equal(U.resolveFileName('a/b:c*d?e"f<g>h|i.pdf'), "abcdefghi.pdf");
  assert.equal(U.resolveFileName("laporan..."), "laporan.pdf");
  assert.equal(U.resolveFileName(""), "gabungan.pdf");
  assert.equal(U.resolveFileName("   "), "gabungan.pdf");
  assert.equal(U.resolveFileName(null), "gabungan.pdf");
  assert.equal(U.resolveFileName("///"), "gabungan.pdf");
  const long = U.resolveFileName("x".repeat(200));
  assert.ok(long.length <= 120 && long.endsWith(".pdf"));
});

/* ---------- optimasi ukuran (lossless) ---------- */

test("optimasi: hasil valid, halaman lengkap, ukuran <= tanpa optimasi", async () => {
  const a = await makePdf([[100, 100], [200, 200], [300, 300]]);
  const b = await makePdf([[400, 400]]);
  const aBytes = await a.save(), bBytes = await b.save();
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const chosen = [
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1 },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2 },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 3 },
    { kind: "pdf", fileUid: "B", pdfBytes: bBytes, pageNum: 1 },
    { kind: "img", imgDataUrl: dataUrl },
  ];
  const { bytes, plainBytes } = await U.buildPdf(pdfLib, chosen, { optimize: true });
  const out = await PDFDocument.load(bytes); // harus tetap valid
  assert.equal(out.getPageCount(), 5);
  assert.ok(plainBytes && plainBytes.length > 0);
  assert.ok(bytes.length <= plainBytes.length, `optimasi tidak boleh lebih besar (${bytes.length} > ${plainBytes.length})`);
  // konten identik: ukuran halaman sama persis antara versi optimasi & polos
  const outPlain = await PDFDocument.load(plainBytes);
  assert.deepEqual(pageSizes(out), pageSizes(outPlain));
});

test("tanpa optimasi: plainBytes null & hasil tetap valid", async () => {
  const a = await makePdf([[100, 100], [200, 200]]);
  const aBytes = await a.save();
  const chosen = [
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1 },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2 },
  ];
  const { bytes, plainBytes } = await U.buildPdf(pdfLib, chosen, { optimize: false });
  assert.equal(plainBytes, null);
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(pageSizes(out), [[100, 100], [200, 200]]);
});

/* ---------- fitur baru: putar halaman ---------- */

test("rotasi: halaman PDF diputar 90 derajat", async () => {
  const a = await makePdf([[100, 200]]);
  const aBytes = await a.save();
  const chosen = [{ kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1, rotation: 90 }];
  const { bytes } = await U.buildPdf(pdfLib, chosen, { optimize: false });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 1);
  assert.equal(out.getPage(0).getRotation().angle, 90);
});

test("rotasi: 0/180/270 & tanpa rotasi tetap normal", async () => {
  const a = await makePdf([[100, 100], [100, 100], [100, 100], [100, 100]]);
  const aBytes = await a.save();
  const chosen = [0, 90, 180, 270].map((r, i) => (
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: i + 1, rotation: r }
  ));
  const { bytes } = await U.buildPdf(pdfLib, chosen, { optimize: false });
  const out = await PDFDocument.load(bytes);
  const angles = [0, 1, 2, 3].map((i) => out.getPage(i).getRotation().angle);
  assert.deepEqual(angles, [0, 90, 180, 270]);
});

/* ---------- fitur baru: nomor halaman ---------- */

test("nomor halaman: hasil valid & jumlah halaman benar (tengah & kanan)", async () => {
  for (const pos of ["center", "right"]) {
    const a = await makePdf([[200, 300], [400, 500], [100, 100]]);
    const aBytes = await a.save();
    const chosen = [1, 2, 3].map((n) => ({ kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: n }));
    const { bytes } = await U.buildPdf(pdfLib, chosen, { optimize: true, pageNumbers: true, pageNumPos: pos });
    const out = await PDFDocument.load(bytes);
    assert.equal(out.getPageCount(), 3);
    assert.deepEqual(pageSizes(out), [[200, 300], [400, 500], [100, 100]]);
  }
});

test("nomor halaman: tanpa opsi -> tidak error & halaman utuh", async () => {
  const a = await makePdf([[200, 300]]);
  const aBytes = await a.save();
  const { bytes } = await U.buildPdf(
    pdfLib,
    [{ kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 1 }],
    { optimize: false, pageNumbers: false }
  );
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 1);
});

/* ---------- fitur baru: split ---------- */

test("parseRanges: format valid", () => {
  assert.deepEqual(U.parseRanges("1-5", 10), [[1, 5]]);
  assert.deepEqual(U.parseRanges("1-5, 8, 10-12", 12), [[1, 5], [8, 8], [10, 12]]);
  assert.deepEqual(U.parseRanges(" 3 , 1-2 ", 5), [[3, 3], [1, 2]]);
  assert.deepEqual(U.parseRanges("5-3", 10), [[3, 5]]); // dibalik otomatis
});

test("parseRanges: format salah / di luar jangkauan -> error", () => {
  assert.throws(() => U.parseRanges("", 10), /Rentang kosong/);
  assert.throws(() => U.parseRanges("abc", 10), /Format salah/);
  assert.throws(() => U.parseRanges("1--5", 10), /Format salah/);
  assert.throws(() => U.parseRanges("0-3", 10), /di luar jangkauan/);
  assert.throws(() => U.parseRanges("1-99", 10), /di luar jangkauan/);
});

test("chunkEveryN: bagi halaman per N", () => {
  assert.deepEqual(U.chunkEveryN(10, 3), [[1, 3], [4, 6], [7, 9], [10, 10]]);
  assert.deepEqual(U.chunkEveryN(5, 1), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
  assert.deepEqual(U.chunkEveryN(4, 10), [[1, 4]]);
  assert.throws(() => U.chunkEveryN(10, 0), />= 1/);
});

test("splitName: nama file bagian + sanitasi", () => {
  assert.equal(U.splitName("dokumen", "1-5"), "dokumen_1-5.pdf");
  assert.equal(U.splitName("dokumen.pdf", "3"), "dokumen_3.pdf");
  assert.equal(U.splitName("a/b", "1"), "ab_1.pdf");
  assert.equal(U.splitName("", "1-2"), "gabungan_1-2.pdf");
});

/* ---------- fitur baru: preset satu-klik ---------- */

test("presetConfig: mapping preset -> kualitas & optimasi", () => {
  assert.deepEqual(U.presetConfig("wa"), { quality: "rendah", optimize: true });
  assert.deepEqual(U.presetConfig("email"), { quality: "sedang", optimize: true });
  assert.deepEqual(U.presetConfig("max"), { quality: "asli", optimize: true });
  assert.equal(U.presetConfig("tidak-ada"), null);
  assert.equal(U.presetConfig(""), null);
});

test("presetKeys: tiga preset tersedia", () => {
  assert.deepEqual(U.presetKeys().sort(), ["email", "max", "wa"]);
});

/* ---------- fitur baru: riwayat lokal ---------- */

test("pushHistory: item baru di depan, dibatasi maksimal", () => {
  const mk = (n) => ({ name: "f" + n + ".pdf", date: "2026-10-13T00:00:00Z", sizeBytes: n * 100, pageCount: n, quality: "asli" });
  let list = [];
  for (let i = 1; i <= 12; i++) list = U.pushHistory(list, mk(i));
  assert.equal(list.length, U.HISTORY_MAX);
  assert.equal(list[0].name, "f12.pdf"); // terbaru di depan
  assert.equal(list[9].name, "f3.pdf");  // yang lama terbuang
});

test("pushHistory: sanitasi item & tidak mutasi array asal", () => {
  const src = [{ name: "a.pdf", date: "2026-10-13T00:00:00Z", sizeBytes: 10, pageCount: 1, quality: "x" }];
  const out = U.pushHistory(src, { name: null, sizeBytes: -5, pageCount: "3" });
  assert.equal(src.length, 1); // asal tidak berubah
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "tanpa nama");
  assert.equal(out[0].sizeBytes, 0);
  assert.equal(out[0].pageCount, 3);
  const empty = U.pushHistory(null, { name: "b.pdf" });
  assert.equal(empty.length, 1);
  assert.ok(empty[0].date); // tanggal otomatis diisi
});

/* ---------- fitur: split (buildSplit) ---------- */

test("buildSplit: pecah PDF jadi beberapa file sesuai rentang", async () => {
  const a = await makePdf([[100, 100], [200, 200], [300, 300], [400, 400], [500, 500]]);
  const aBytes = await a.save();
  const parts = await U.buildSplit(pdfLib, aBytes, [[1, 2], [3, 3], [4, 5]], { optimize: true });
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((x) => x.label), ["1-2", "3", "4-5"]);
  const counts = [];
  for (const part of parts) {
    const d = await PDFDocument.load(part.bytes);
    counts.push(d.getPageCount());
  }
  assert.deepEqual(counts, [2, 1, 2]);
  const d0 = await PDFDocument.load(parts[0].bytes);
  assert.deepEqual(pageSizes(d0), [[100, 100], [200, 200]]);
});
