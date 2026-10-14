/* Test fondasi kompres PDF (jalan di node).
 * Menguji kode ASLI di assets/js/pdfutil.js: listImageXObjects & decodeImagePixels.
 * Jalankan: node --test tests/compress.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from "pdf-lib";

const require = createRequire(import.meta.url);
const U = require("../assets/js/pdfutil.js");
// pdf-lib sebagai namespace (fungsi util menerima PDFLib sebagai argumen)
import * as PDFLib from "pdf-lib";

const inflate = async (b) => zlib.inflateSync(Buffer.from(b));

// PNG 2x2 RGB valid
const PNG_2x2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGP8//8/AzGAiShVWGwAABuoAv8a5sRrAAAAAElFTkSuQmCC";

async function makePdfWithPng() {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(Buffer.from(PNG_2x2, "base64"));
  doc.addPage([200, 200]).drawImage(png, { x: 0, y: 0, width: 100, height: 100 });
  return doc.save();
}

test("listImageXObjects menemukan 1 gambar RGB Flate", async () => {
  const bytes = await makePdfWithPng();
  const doc = await PDFDocument.load(bytes);
  const imgs = U.listImageXObjects(PDFLib, doc);
  assert.equal(imgs.length, 1);
  const im = imgs[0];
  assert.equal(im.width, 2);
  assert.equal(im.height, 2);
  assert.deepEqual(im.filters, ["FlateDecode"]);
  assert.equal(im.colorSpace.family, "rgb");
  assert.equal(im.bitsPerComponent, 8);
  assert.equal(im.isMask, false);
  assert.ok(im.stream.getContents().length > 0);
});

test("decodeImagePixels: Flate RGB tanpa predictor -> RGBA benar", async () => {
  const bytes = await makePdfWithPng();
  const doc = await PDFDocument.load(bytes);
  const [im] = U.listImageXObjects(PDFLib, doc);
  const d = await U.decodeImagePixels(PDFLib, im.stream.getContents(), im, inflate);
  assert.equal(d.width, 2);
  assert.equal(d.height, 2);
  assert.equal(d.rgba.length, 16);
  // semua alpha 255
  for (let i = 3; i < 16; i += 4) assert.equal(d.rgba[i], 255);
});

test("decodeImagePixels: DCTDecode melempar NEED_JPEG", async () => {
  const info = { filters: ["DCTDecode"], width: 4, height: 4, bitsPerComponent: 8, colorSpace: { family: "rgb" } };
  await assert.rejects(U.decodeImagePixels(PDFLib, new Uint8Array(8), info, inflate), /NEED_JPEG/);
});

test("decodeImagePixels: predictor PNG (Sub) dibalik dengan benar", async () => {
  // 2x1 RGB, tiap baris: filter=1 (Sub), lalu 6 byte delta
  // piksel asli: (10,20,30) (40,50,60) -> encoded: (10,20,30) (30,30,30)
  const raw = new Uint8Array([1, 10, 20, 30, 30, 30, 30]);
  const zipped = zlib.deflateSync(raw);
  const info = {
    filters: ["FlateDecode"], width: 2, height: 1, bitsPerComponent: 8,
    colorSpace: { family: "rgb" },
    decodeParms: (() => {
      const d = PDFDict.withContext(PDFDocument.create().context);
      return d;
    })(),
  };
  // set Predictor=12 via dict langsung
  info.decodeParms.set(PDFName.of("Predictor"), PDFNumber.of(12));
  const d = await U.decodeImagePixels(PDFLib, zipped, info, inflate);
  assert.deepEqual(Array.from(d.rgba), [10, 20, 30, 255, 40, 50, 60, 255]);
});

test("decodeImagePixels: grayscale 8-bit", async () => {
  const raw = new Uint8Array([0, 127, 255, 64]); // 2x2 gray
  const info = { filters: [], width: 2, height: 2, bitsPerComponent: 8, colorSpace: { family: "gray" } };
  const d = await U.decodeImagePixels(PDFLib, raw, info, inflate);
  assert.deepEqual(Array.from(d.rgba), [0, 0, 0, 255, 127, 127, 127, 255, 255, 255, 255, 255, 64, 64, 64, 255]);
});

test("decodeImagePixels: 1-bit gray di-expand", async () => {
  // 8 piksel 1-bit: 10110001 -> 255,0,255,255,0,0,0,255
  const raw = new Uint8Array([0b10110001]);
  const info = { filters: [], width: 8, height: 1, bitsPerComponent: 1, colorSpace: { family: "gray" } };
  const d = await U.decodeImagePixels(PDFLib, raw, info, inflate);
  const reds = [];
  for (let i = 0; i < 32; i += 4) reds.push(d.rgba[i]);
  assert.deepEqual(reds, [255, 0, 255, 255, 0, 0, 0, 255]);
});

test("decodeImagePixels: indexed -> RGB", async () => {
  // palet: idx0=merah, idx1=hijau ; piksel: 0,1,1,0 (2x2, bpc 1)
  const palette = new Uint8Array([255, 0, 0, 0, 255, 0]);
  const raw = new Uint8Array([0b01100000]);
  const info = {
    filters: [], width: 2, height: 2, bitsPerComponent: 1,
    colorSpace: { family: "indexed", base: { family: "rgb" }, hival: 1, palette },
  };
  const d = await U.decodeImagePixels(PDFLib, raw, info, inflate);
  const px = [];
  for (let i = 0; i < 16; i += 4) px.push([d.rgba[i], d.rgba[i + 1], d.rgba[i + 2]]);
  assert.deepEqual(px, [[255, 0, 0], [0, 255, 0], [0, 255, 0], [255, 0, 0]]);
});

test("decodeImagePixels: CMYK putih & hitam", async () => {
  const info = { filters: [], width: 2, height: 1, bitsPerComponent: 8, colorSpace: { family: "cmyk" } };
  const raw = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]); // putih, hitam
  const d = await U.decodeImagePixels(PDFLib, raw, info, inflate);
  assert.deepEqual([d.rgba[0], d.rgba[1], d.rgba[2]], [255, 255, 255]);
  assert.deepEqual([d.rgba[4], d.rgba[5], d.rgba[6]], [0, 0, 0]);
});

test("decodeImagePixels: filter tak didukung melempar", async () => {
  const info = { filters: ["JPXDecode"], width: 2, height: 2, bitsPerComponent: 8, colorSpace: { family: "rgb" } };
  await assert.rejects(U.decodeImagePixels(PDFLib, new Uint8Array(8), info, inflate), /tak didukung/);
});

test("decodeImagePixels: Decode array melempar (aman)", async () => {
  const info = { filters: [], width: 1, height: 1, bitsPerComponent: 8, colorSpace: { family: "gray" }, hasDecode: true };
  await assert.rejects(U.decodeImagePixels(PDFLib, new Uint8Array([9]), info, inflate), /Decode/);
});

test("alur ganti stream: Flate -> DCTDecode tetap valid", async () => {
  const bytes = await makePdfWithPng();
  const doc = await PDFDocument.load(bytes);
  const [im] = U.listImageXObjects(PDFLib, doc);
  const nd = PDFDict.withContext(doc.context);
  nd.set(PDFName.of("Type"), PDFName.of("XObject"));
  nd.set(PDFName.of("Subtype"), PDFName.of("Image"));
  nd.set(PDFName.of("Width"), PDFNumber.of(2));
  nd.set(PDFName.of("Height"), PDFNumber.of(2));
  nd.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  nd.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
  nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
  doc.context.assign(im.ref, PDFRawStream.of(nd, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
  const out = await doc.save({ useObjectStreams: true });
  const doc2 = await PDFDocument.load(out);
  const [im2] = U.listImageXObjects(PDFLib, doc2);
  assert.deepEqual(im2.filters, ["DCTDecode"]);
  assert.equal(im2.width, 2);
});
