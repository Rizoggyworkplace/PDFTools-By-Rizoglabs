/* Test logika merge PDF Tools (jalan di node, pakai pdf-lib).
 * Teknik yang dites = teknik yang dipakai assets/js/app.js::buildPdf
 * dan assets/js/app.js::resolveFileName.
 * Jalankan: NODE_PATH=/tmp/pdftest/node_modules node --test tests/merge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

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

// Replika buildPdf() dari app.js: gabung halaman terpilih sesuai urutan.
// Mengembalikan { bytes, plainBytes } persis seperti app.js.
async function buildPdf(chosen, optimize) {
  const out = await PDFDocument.create();
  const cache = new Map();
  for (const p of chosen) {
    if (p.kind === "pdf") {
      let src = cache.get(p.fileUid);
      if (!src) { src = await PDFDocument.load(p.pdfBytes); cache.set(p.fileUid, src); }
      const [cp] = await out.copyPages(src, [p.pageNum - 1]);
      out.addPage(cp);
    } else {
      const jpg = await out.embedJpg(p.imgDataUrl);
      const pg = out.addPage([jpg.width, jpg.height]);
      pg.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    }
  }
  if (optimize) {
    const plainBytes = await out.save({ useObjectStreams: false });
    const bytes = await out.save({ useObjectStreams: true });
    return { bytes, plainBytes };
  }
  return { bytes: await out.save({ useObjectStreams: false }), plainBytes: null };
}

// Replika resolveFileName() dari app.js
function resolveFileName(raw) {
  let s = String(raw == null ? "" : raw).trim();
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
  s = s.replace(/\.+$/g, "");
  if (!s) s = "gabungan";
  if (/\.pdf$/i.test(s)) return s.length <= 120 ? s : s.slice(0, 116) + ".pdf";
  return s.slice(0, 116) + ".pdf";
}

// Replika collectChosen() dari app.js: file berurutan -> halaman included per file.
function collectChosen(files, pages) {
  const out = [];
  for (const f of files)
    for (const p of pages)
      if (p.fileUid === f.uid && p.included) out.push(p);
  return out;
}

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
  const { bytes } = await buildPdf(chosen, true);
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
  const { bytes } = await buildPdf(chosen, true);
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[100, 100], [500, 500], [300, 300]]);
});

test("gambar (JPEG) menjadi satu halaman penuh", async () => {
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const { bytes } = await buildPdf([{ kind: "img", imgDataUrl: dataUrl }], true);
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
  const { bytes } = await buildPdf(collectChosen(files, pages), true);
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
  const { bytes } = await buildPdf(collectChosen(filesReordered, pages), true);
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
  const { bytes } = await buildPdf(collectChosen(files, pages), true);
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[1, 1], [100, 100], [300, 300]]);
});

/* ---------- fitur baru: nama file hasil ---------- */

test("resolveFileName: nama custom dipakai, .pdf ditambah otomatis", () => {
  assert.equal(resolveFileName("laporan bulanan"), "laporan bulanan.pdf");
  assert.equal(resolveFileName("laporan.pdf"), "laporan.pdf");
  assert.equal(resolveFileName("LAPORAN.PDF"), "LAPORAN.PDF");
  assert.equal(resolveFileName("  spasi  "), "spasi.pdf");
});

test("resolveFileName: sanitasi karakter ilegal & fallback default", () => {
  assert.equal(resolveFileName('a/b:c*d?e"f<g>h|i.pdf'), "abcdefghi.pdf");
  assert.equal(resolveFileName("laporan..."), "laporan.pdf");
  assert.equal(resolveFileName(""), "gabungan.pdf");
  assert.equal(resolveFileName("   "), "gabungan.pdf");
  assert.equal(resolveFileName(null), "gabungan.pdf");
  assert.equal(resolveFileName("///"), "gabungan.pdf");
  const long = resolveFileName("x".repeat(200));
  assert.ok(long.length <= 120 && long.endsWith(".pdf"));
});

/* ---------- fitur baru: optimasi ukuran (lossless) ---------- */

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
  const { bytes, plainBytes } = await buildPdf(chosen, true);
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
  const { bytes, plainBytes } = await buildPdf(chosen, false);
  assert.equal(plainBytes, null);
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(pageSizes(out), [[100, 100], [200, 200]]);
});
