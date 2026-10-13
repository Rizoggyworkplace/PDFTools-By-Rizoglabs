/* Test logika merge PDF Tools (jalan di node, pakai pdf-lib).
 * Teknik yang dites = teknik yang dipakai assets/js/app.js::buildPdf.
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
async function buildPdf(chosen) {
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
  const out = await buildPdf(chosen);
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
  const out = await buildPdf(chosen);
  assert.equal(out.getPageCount(), 3);
  assert.deepEqual(pageSizes(out), [[100, 100], [500, 500], [300, 300]]);
});

test("gambar (JPEG) menjadi satu halaman penuh", async () => {
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const out = await buildPdf([{ kind: "img", imgDataUrl: dataUrl }]);
  assert.equal(out.getPageCount(), 1);
  const [w, h] = pageSizes(out)[0];
  assert.equal(w, 1); assert.equal(h, 1); // ukuran halaman = ukuran gambar
});

test("campuran PDF + gambar dalam satu hasil", async () => {
  const a = await makePdf([[100, 100], [200, 200]]);
  const aBytes = await a.save();
  const dataUrl = "data:image/jpeg;base64," + JPG_1x1;
  const chosen = [
    { kind: "img", imgDataUrl: dataUrl },
    { kind: "pdf", fileUid: "A", pdfBytes: aBytes, pageNum: 2 },
  ];
  const out = await buildPdf(chosen);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(pageSizes(out), [[1, 1], [200, 200]]);
});
