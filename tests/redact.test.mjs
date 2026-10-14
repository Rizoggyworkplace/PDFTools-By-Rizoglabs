/* Test fondasi samarkan/redact (jalan di node).
 * Menguji kode ASLI di assets/js/pdfutil.js: findTextRects, unionRects, normRect, mulTransform.
 * Jalankan: node --test tests/redact.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const U = require("../assets/js/pdfutil.js");

test("findTextRects: cocok 1 item", () => {
  const boxes = [
    { str: "Halo", x: 0, y: 0, w: 40, h: 12 },
    { str: "dunia", x: 44, y: 0, w: 50, h: 12 },
  ];
  const r = U.findTextRects(boxes, "dunia");
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { x: 44, y: 0, w: 50, h: 12 });
});

test("findTextRects: case-insensitive & gabung lintas item", () => {
  const boxes = [
    { str: "NIK", x: 0, y: 0, w: 30, h: 12 },
    { str: "123", x: 32, y: 0, w: 30, h: 12 },
    { str: "456", x: 64, y: 0, w: 30, h: 12 },
  ];
  const r = U.findTextRects(boxes, "nik 123");
  assert.equal(r.length, 1);
  assert.equal(r[0].x, 0);
  assert.equal(r[0].w, 62); // 0..62
});

test("findTextRects: beberapa kemunculan", () => {
  const boxes = [
    { str: "rahasia", x: 0, y: 0, w: 60, h: 12 },
    { str: "biasa", x: 0, y: 20, w: 50, h: 12 },
    { str: "rahasia", x: 0, y: 40, w: 60, h: 12 },
  ];
  const r = U.findTextRects(boxes, "rahasia");
  assert.equal(r.length, 2);
  assert.equal(r[0].y, 0);
  assert.equal(r[1].y, 40);
});

test("findTextRects: kosong & tak cocok", () => {
  assert.deepEqual(U.findTextRects([], "x"), []);
  assert.deepEqual(U.findTextRects([{ str: "abc", x: 0, y: 0, w: 1, h: 1 }], "   "), []);
  assert.deepEqual(U.findTextRects([{ str: "abc", x: 0, y: 0, w: 1, h: 1 }], "zzz"), []);
});

test("unionRects: gabung benar", () => {
  const r = U.unionRects([
    { x: 10, y: 10, w: 20, h: 20 },
    { x: 25, y: 5, w: 10, h: 10 },
  ]);
  assert.deepEqual(r, { x: 10, y: 5, w: 25, h: 25 });
});

test("normRect: drag dari arah mana pun", () => {
  assert.deepEqual(U.normRect(5, 5, 15, 25), { x: 5, y: 5, w: 10, h: 20 });
  assert.deepEqual(U.normRect(15, 25, 5, 5), { x: 5, y: 5, w: 10, h: 20 });
});

test("mulTransform: identitas & translasi", () => {
  const id = [1, 0, 0, 1, 0, 0];
  const t = [1, 0, 0, 1, 10, 20];
  assert.deepEqual(U.mulTransform(id, t), t);
  assert.deepEqual(U.mulTransform(t, id), t);
  // skala 2 lalu translasi: titik (5,5) -> (2*5+10, 2*5+20) = (20,30)
  const s = [2, 0, 0, 2, 10, 20];
  const p = U.mulTransform(s, [1, 0, 0, 1, 5, 5]);
  assert.deepEqual([p[4], p[5]], [20, 30]);
});

test("findPatternRects: NIK 16 digit ketemu", () => {
  const boxes = [
    { str: "NIK", x: 0, y: 0, w: 30, h: 12 },
    { str: ":", x: 32, y: 0, w: 8, h: 12 },
    { str: "3174010101900001", x: 42, y: 0, w: 140, h: 12 },
    { str: "telp", x: 0, y: 20, w: 30, h: 12 },
  ];
  const r = U.findPatternRects(boxes, /\b\d{16}\b/g);
  assert.equal(r.length, 1);
  assert.equal(r[0].x, 42);
});

test("findPatternRects: email & no HP", () => {
  const boxes = [
    { str: "hubungi", x: 0, y: 0, w: 60, h: 12 },
    { str: "budi@mail.com", x: 62, y: 0, w: 110, h: 12 },
    { str: "atau", x: 0, y: 20, w: 40, h: 12 },
    { str: "081234567890", x: 42, y: 20, w: 110, h: 12 },
  ];
  const em = U.findPatternRects(boxes, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  assert.equal(em.length, 1);
  assert.equal(em[0].x, 62);
  const hp = U.findPatternRects(boxes, /\b08\d{8,12}\b/g);
  assert.equal(hp.length, 1);
  assert.equal(hp[0].y, 20);
});

test("findPatternRects: tanpa flag g tetap jalan & tak cocok -> []", () => {
  const boxes = [{ str: "abc 123", x: 0, y: 0, w: 50, h: 12 }];
  const r = U.findPatternRects(boxes, /\d{3}/);
  assert.equal(r.length, 1);
  assert.deepEqual(U.findPatternRects(boxes, /\d{16}/g), []);
});

test("findTextMatches: mengembalikan teks yang cocok", () => {
  const boxes = [
    { str: "NIK", x: 0, y: 0, w: 30, h: 12 },
    { str: "3174010101900001", x: 32, y: 0, w: 140, h: 12 },
  ];
  const m = U.findTextMatches(boxes, "nik 3174010101900001");
  assert.equal(m.length, 1);
  assert.equal(m[0].text, "NIK 3174010101900001");
  assert.equal(m[0].x, 0);
});

test("findPatternMatches: teks pola ikut terbawa", () => {
  const boxes = [{ str: "hubungi budi@mail.com ya", x: 0, y: 0, w: 200, h: 12 }];
  const m = U.findPatternMatches(boxes, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, "budi@mail.com");
});

test("rectsOverlap & textUnderRect", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(U.rectsOverlap(a, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(U.rectsOverlap(a, { x: 20, y: 20, w: 5, h: 5 }), false);
  const tbs = [
    { str: "Rahasia", x: 0, y: 0, w: 50, h: 12 },
    { str: "negara", x: 52, y: 0, w: 50, h: 12 },
    { str: "jauh", x: 0, y: 100, w: 40, h: 12 },
  ];
  assert.equal(U.textUnderRect(tbs, { x: 0, y: 0, w: 110, h: 14 }), "Rahasia negara");
  assert.equal(U.textUnderRect(tbs, { x: 200, y: 200, w: 10, h: 10 }), "");
});
