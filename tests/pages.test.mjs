/* Test fitur baru: Atur Halaman, Watermark, Tanda Tangan, PDF ke Gambar.
 * Menguji kode ASLI di assets/js/pdfutil.js (bukan replika).
 * Jalankan: node --test tests/pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import pdfLib from "pdf-lib"; // namespace lengkap utk PdfUtil

const require = createRequire(import.meta.url);
const U = require("../assets/js/pdfutil.js");

// PNG 1x1 transparan valid
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const pngBytes = new Uint8Array(Buffer.from(PNG_1x1, "base64"));

async function makePdf(sizes) {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

function pageSizes(doc) {
  const out = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { width, height } = doc.getPage(i).getSize();
    out.push([Math.round(width), Math.round(height)]);
  }
  return out;
}

/* ---------- atur halaman ---------- */

test("normalizeRotation", () => {
  assert.equal(U.normalizeRotation(0), 0);
  assert.equal(U.normalizeRotation(90), 90);
  assert.equal(U.normalizeRotation(-90), 270);
  assert.equal(U.normalizeRotation(450), 90);
  assert.equal(U.normalizeRotation(360), 0);
  assert.equal(U.normalizeRotation(undefined), 0);
});

test("planFromPages: urutan + hapus + rotasi", () => {
  const state = [
    { src: 0, rot: 0, deleted: false },
    { src: 1, rot: 90, deleted: false },
    { src: 2, rot: 0, deleted: true },
  ];
  assert.deepEqual(U.planFromPages(state), [
    { src: 1, rotation: 0 },
    { src: 2, rotation: 90 },
  ]);
  assert.deepEqual(U.planFromPages([]), []);
  assert.deepEqual(U.planFromPages(null), []);
});

test("applyPagePlan: susun ulang + hapus + putar", async () => {
  const src = await makePdf([[100, 100], [200, 200], [300, 300]]);
  const out = await U.applyPagePlan(pdfLib, src, [
    { src: 3, rotation: 0 },
    { src: 1, rotation: 90 },
  ]);
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(pageSizes(doc), [[300, 300], [100, 100]]);
  assert.equal(doc.getPage(1).getRotation().angle, 90);
  assert.equal(doc.getPage(0).getRotation().angle, 0);
});

test("applyPagePlan: plan kosong & src di luar jangkauan", async () => {
  const src = await makePdf([[100, 100]]);
  // Quirk pdf-lib: dokumen 0 halaman saat save jadi 1 halaman kosong.
  // Aplikasi memblokir plan kosong di UI (toast), di sini cukup pastikan tidak throw.
  const empty = await U.applyPagePlan(pdfLib, src, []);
  assert.equal((await PDFDocument.load(empty)).getPageCount(), 1);
  const skip = await U.applyPagePlan(pdfLib, src, [{ src: 99, rotation: 0 }, { src: 1, rotation: 0 }]);
  assert.equal((await PDFDocument.load(skip)).getPageCount(), 1);
});

/* ---------- watermark ---------- */

test("centeredTextPoint: sudut 0 menaruh teks tepat di tengah", () => {
  const p = U.centeredTextPoint(300, 400, 200, 48, 0);
  assert.equal(p.x, 200);
  assert.equal(p.y, 376);
});

test("centeredTextPoint: sudut 90 menukar sumbu", () => {
  const p = U.centeredTextPoint(300, 400, 200, 48, 90);
  // u=(0,1), v=(-1,0): x = 300 - 24*(-1) = 324? hitung: x = 300 - 100*0 - 24*(-1) = 324
  assert.ok(Math.abs(p.x - 324) < 0.001);
  assert.ok(Math.abs(p.y - 300) < 0.001);
});

test("watermarkPositions: center 1 titik di tengah; tile grid > 1", () => {
  const c = U.watermarkPositions(595, 842, "RAHASIA", 48, -45, "center");
  assert.equal(c.length, 1);
  assert.equal(c[0].x, 595 / 2);
  assert.equal(c[0].y, 842 / 2);
  const t = U.watermarkPositions(595, 842, "RAHASIA", 48, -45, "tile");
  assert.ok(t.length > 4);
  for (const p of t) {
    assert.ok(p.x >= 0 && p.x <= 595 + 300);
    assert.ok(p.y >= 0 && p.y <= 842 + 300);
  }
});

test("applyWatermark: halaman tetap, isi berubah, mode tile jalan", async () => {
  const src = await makePdf([[595, 842], [595, 842]]);
  const a = await U.applyWatermark(pdfLib, src, { text: "DRAFT", size: 60, opacity: 0.4, angle: -45, color: [1, 0, 0], mode: "center" });
  const docA = await PDFDocument.load(a);
  assert.equal(docA.getPageCount(), 2);
  assert.ok(a.length > src.length);
  const b = await U.applyWatermark(pdfLib, src, { text: "X", size: 24, opacity: 0.2, angle: -30, mode: "tile" });
  assert.equal((await PDFDocument.load(b)).getPageCount(), 2);
  // default kosong -> "RAHASIA", tetap jalan
  const c = await U.applyWatermark(pdfLib, src, {});
  assert.equal((await PDFDocument.load(c)).getPageCount(), 2);
});

/* ---------- tanda tangan ---------- */

test("signatureRect: posisi kiri/tengah/kanan di bawah halaman", () => {
  const l = U.signatureRect(595, 842, 300, 100, "left", 150, 36);
  assert.deepEqual(l, { x: 36, y: 36, w: 150, h: 50 });
  const c = U.signatureRect(595, 842, 300, 100, "center", 150, 36);
  assert.equal(c.x, (595 - 150) / 2);
  assert.equal(c.y, 36);
  const r = U.signatureRect(595, 842, 300, 100, "right", 150, 36);
  assert.equal(r.x, 595 - 150 - 36);
  // lebar dijepit ke lebar halaman
  const big = U.signatureRect(200, 200, 300, 100, "right", 500, 10);
  assert.equal(big.w, 180);
  assert.equal(big.x, 10);
  // tanda tangan vertikal: tinggi dibatasi 150 pt, lebar ikut mengecil
  const tall = U.signatureRect(595, 842, 100, 300, "right", 150, 36);
  assert.equal(tall.h, 150);
  assert.ok(Math.abs(tall.w - 50) < 0.001);
  assert.equal(tall.x, 595 - tall.w - 36);
});

test("applySignature: menempel di halaman yang dipilih", async () => {
  const src = await makePdf([[595, 842], [595, 842]]);
  const out = await U.applySignature(pdfLib, src, pngBytes, { page: 2, pos: "right", width: 150 });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2);
  assert.ok(out.length > src.length);
  // halaman di luar jangkauan dijepit ke halaman terakhir
  const out2 = await U.applySignature(pdfLib, src, pngBytes, { page: 99 });
  assert.equal((await PDFDocument.load(out2)).getPageCount(), 2);
});

test("applySignature: rect bebas dipakai apa adanya", async () => {
  const src = await makePdf([[595, 842]]);
  const out = await U.applySignature(pdfLib, src, pngBytes, { page: 1, rect: { x: 100, y: 200, w: 120, h: 40 } });
  assert.equal((await PDFDocument.load(out)).getPageCount(), 1);
  assert.ok(out.length > src.length);
});

/* ---------- PDF ke gambar ---------- */

test("imageFileName: padding ikut jumlah halaman", () => {
  assert.equal(U.imageFileName("dokumen", 1, 12, "jpg"), "dokumen-01.jpg");
  assert.equal(U.imageFileName("dokumen", 12, 12, "png"), "dokumen-12.png");
  assert.equal(U.imageFileName("dokumen", 3, 5, "jpg"), "dokumen-3.jpg");
  assert.equal(U.imageFileName("laporan.pdf", 2, 100, "jpg"), "laporan-002.jpg");
  assert.equal(U.imageFileName("", 1, 1, "jpg"), "dokumen-1.jpg");
});
