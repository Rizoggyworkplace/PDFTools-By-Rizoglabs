/* PDF Tools — util murni (tanpa DOM).
 * Dipakai oleh assets/js/app.js (browser, via window.PdfUtil)
 * dan tests/merge.test.mjs (node, via require/import).
 * Semua fungsi yang butuh pdf-lib menerima objek PDFLib sebagai argumen
 * agar tidak ada import library di dalam file ini.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PdfUtil = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- nama file & format ukuran ---------- */

  // Bersihkan nama file dari karakter ilegal; pastikan berekstensi .pdf.
  function resolveFileName(raw) {
    let s = String(raw == null ? "" : raw).trim();
    s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ""); // karakter ilegal nama file
    s = s.replace(/\.+$/g, "");                  // titik di ujung
    if (!s) s = "gabungan";
    if (/\.pdf$/i.test(s)) return s.length <= 120 ? s : s.slice(0, 116) + ".pdf";
    return s.slice(0, 116) + ".pdf";
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2).replace(".", ",") + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }

  /* ---------- split: parsing rentang & chunk ---------- */

  // "1-3, 5, 7-9" + jumlah halaman -> [[1,3],[5,5],[7,9]] (1-based, inklusif).
  // Melempar Error bila format salah atau di luar 1..numPages.
  function parseRanges(str, numPages) {
    const s = String(str == null ? "" : str).trim();
    if (!s) throw new Error("Rentang kosong. Contoh: 1-5, 8, 10-12");
    const out = [];
    for (const tok of s.split(",")) {
      const t = tok.trim();
      const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw new Error('Format salah: "' + t + '". Contoh: 1-5, 8, 10-12');
      let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a < 1 || b < 1 || a > numPages || b > numPages)
        throw new Error("Halaman " + t + " di luar jangkauan (1–" + numPages + ")");
      if (a > b) { const tmp = a; a = b; b = tmp; }
      out.push([a, b]);
    }
    return out;
  }

  // Bagi numPages menjadi chunk tiap n halaman -> [[1,n],[n+1,2n],...]
  function chunkEveryN(numPages, n) {
    n = Math.floor(Number(n));
    if (!n || n < 1) throw new Error("N harus bilangan bulat >= 1");
    const out = [];
    for (let s = 1; s <= numPages; s += n) out.push([s, Math.min(s + n - 1, numPages)]);
    return out;
  }

  // Nama file hasil split: "dokumen" + label "1-5" -> "dokumen_1-5.pdf"
  function splitName(base, label) {
    let b = String(base == null ? "" : base).trim().replace(/\.pdf$/i, "");
    if (!b) b = "gabungan";
    return resolveFileName(b + "_" + label);
  }

  /* ---------- merge inti ---------- */

  // chosen: [{kind:'pdf'|'img', fileUid, pdfBytes, pageNum, imgDataUrl, rotation:0|90|180|270}]
  // opts: {optimize:boolean, pageNumbers:boolean, pageNumPos:'center'|'right'}
  // Mengembalikan {bytes, plainBytes} — plainBytes hanya diisi bila optimize=true
  // (versi tanpa object streams, untuk perbandingan ukuran).
  async function buildPdf(PDFLib, chosen, opts) {
    opts = opts || {};
    const out = await PDFLib.PDFDocument.create();
    const cache = new Map(); // fileUid -> PDFLib.PDFDocument
    for (const p of chosen) {
      if (p.kind === "pdf") {
        let src = cache.get(p.fileUid);
        if (!src) { src = await PDFLib.PDFDocument.load(p.pdfBytes); cache.set(p.fileUid, src); }
        const [cp] = await out.copyPages(src, [p.pageNum - 1]);
        const rot = ((Number(p.rotation) || 0) % 360 + 360) % 360;
        if (rot) {
          const cur = src.getPage(p.pageNum - 1).getRotation().angle;
          cp.setRotation(PDFLib.degrees((cur + rot) % 360));
        }
        out.addPage(cp);
      } else {
        const jpg = await out.embedJpg(p.imgDataUrl);
        const pg = out.addPage([jpg.width, jpg.height]);
        pg.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
      }
    }
    if (opts.pageNumbers) applyPageNumbers(PDFLib, out, opts.pageNumPos);
    if (opts.optimize) {
      const plainBytes = await out.save({ useObjectStreams: false });
      const bytes = await out.save({ useObjectStreams: true });
      return { bytes: bytes, plainBytes: plainBytes };
    }
    return { bytes: await out.save({ useObjectStreams: false }), plainBytes: null };
  }

  // Gambar nomor halaman 1..N di tiap halaman (bawah-tengah / bawah-kanan).
  async function applyPageNumbers(PDFLib, doc, pos) {
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      const size = pg.getSize();
      const label = String(i + 1);
      const fs = 10;
      const tw = font.widthOfTextAtSize(label, fs);
      const x = pos === "right" ? size.width - tw - 24 : (size.width - tw) / 2;
      pg.drawText(label, {
        x: x, y: 22, size: fs, font: font,
        color: PDFLib.rgb(0.35, 0.35, 0.35),
      });
    }
  }

  /* ---------- split inti ---------- */

  // ranges: [[start,end],...] 1-based inklusif. Mengembalikan [{label, bytes}].
  async function buildSplit(PDFLib, srcBytes, ranges, opts) {
    opts = opts || {};
    const src = await PDFLib.PDFDocument.load(srcBytes);
    const out = [];
    for (const [s, e] of ranges) {
      const doc = await PDFLib.PDFDocument.create();
      const idx = [];
      for (let n = s; n <= e; n++) idx.push(n - 1);
      const cps = await doc.copyPages(src, idx);
      cps.forEach((cp) => doc.addPage(cp));
      const bytes = await doc.save({ useObjectStreams: opts.optimize !== false });
      out.push({ label: s === e ? String(s) : s + "-" + e, bytes: bytes });
    }
    return out;
  }

  /* ---------- kompres PDF: baca & decode gambar (murni, bisa di-test) ---------- */
  // Catatan: fungsi di sini TIDAK menyentuh DOM/canvas. Decode JPEG (DCTDecode)
  // dilakukan pemanggil via ImageBitmap; inflate di-inject agar bisa di-test.

  // Daftar semua XObject gambar di dokumen.
  // -> [{ref, stream, dict, width, height, filters:[], colorSpace, bitsPerComponent,
  //      isMask, sMaskRef, maskRef, hasDecode, decodeParms}]
  function listImageXObjects(PDFLib, doc) {
    const N = PDFLib.PDFName;
    const out = [];
    for (const [ref, obj] of doc.context.indirectObjects) {
      if (!obj || !obj.dict || typeof obj.getContents !== "function") continue;
      const dict = obj.dict;
      const st = dict.get(N.of("Subtype"));
      if (!st || st.toString() !== "/Image") continue;
      const w = dict.get(N.of("Width")), h = dict.get(N.of("Height"));
      const width = w && typeof w.asNumber === "function" ? w.asNumber() : 0;
      const height = h && typeof h.asNumber === "function" ? h.asNumber() : 0;
      if (!width || !height) continue;
      const filters = [];
      const f = dict.get(N.of("Filter"));
      if (f) {
        const arr = f instanceof PDFLib.PDFArray ? f.asArray() : [f];
        for (const x of arr) if (x) filters.push(String(x.toString()).replace(/^\//, ""));
      }
      const bpcV = dict.get(N.of("BitsPerComponent"));
      const bpc = bpcV && typeof bpcV.asNumber === "function" ? bpcV.asNumber() : 8;
      const im = dict.get(N.of("ImageMask"));
      const sMask = dict.get(N.of("SMask"));
      const msk = dict.get(N.of("Mask"));
      let dp = dict.get(N.of("DecodeParms"));
      if (dp instanceof PDFLib.PDFRef) { try { dp = doc.context.lookup(dp); } catch (e) { dp = null; } }
      if (dp instanceof PDFLib.PDFArray) {
        const a = dp.asArray(); dp = a.length ? a[0] : null;
        if (dp instanceof PDFLib.PDFRef) { try { dp = doc.context.lookup(dp); } catch (e) { dp = null; } }
      }
      out.push({
        ref: ref, stream: obj, dict: dict,
        width: width, height: height, filters: filters,
        colorSpace: parseColorSpace(PDFLib, dict.get(N.of("ColorSpace"))),
        bitsPerComponent: bpc,
        isMask: !!(im && im.toString() === "true"),
        sMaskRef: sMask instanceof PDFLib.PDFRef ? sMask : null,
        maskRef: msk instanceof PDFLib.PDFRef ? msk : null,
        hasDecode: !!dict.get(N.of("Decode")),
        decodeParms: dp && typeof dp.get === "function" ? dp : null,
      });
    }
    return out;
  }

  // -> {family:'rgb'|'gray'|'cmyk'|'indexed'|'unknown', base?, hival?, palette?}
  function parseColorSpace(PDFLib, cs) {
    if (!cs) return { family: "unknown" };
    const s = cs.toString();
    if (s === "/DeviceRGB" || s === "/CalRGB") return { family: "rgb" };
    if (s === "/DeviceGray" || s === "/CalGray") return { family: "gray" };
    if (s === "/DeviceCMYK") return { family: "cmyk" };
    if (cs instanceof PDFLib.PDFArray) {
      const a = cs.asArray();
      const name = a.length && a[0] ? a[0].toString() : "";
      if (name === "/Indexed" && a.length >= 4) {
        const hival = a[2] && typeof a[2].asNumber === "function" ? a[2].asNumber() : 0;
        const lookup = a[3];
        let palette = null;
        if (lookup) {
          if (typeof lookup.getContents === "function") { try { palette = lookup.getContents(); } catch (e) {} }
          else { const t = lookup.toString(); if (t.charAt(0) === "<") palette = hexToBytes(t.slice(1, t.length - 1)); }
        }
        return { family: "indexed", base: parseColorSpace(PDFLib, a[1]), hival: hival, palette: palette };
      }
    }
    return { family: "unknown" };
  }

  function hexToBytes(hex) {
    const h = String(hex).replace(/[^0-9a-fA-F]/g, "");
    const out = new Uint8Array(Math.floor(h.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  // Decode isi stream gambar menjadi RGBA.
  // rawBytes: isi stream mentah. inflate: async (Uint8Array)->Uint8Array (untuk FlateDecode).
  // DCTDecode (JPEG) dilempar dengan pesan "NEED_JPEG" — pemanggil decode via ImageBitmap.
  // -> Promise<{width, height, rgba:Uint8ClampedArray}>
  async function decodeImagePixels(PDFLib, rawBytes, info, inflate) {
    const filters = info.filters || [];
    if (filters.indexOf("DCTDecode") >= 0) throw new Error("NEED_JPEG");
    let data = rawBytes;
    if (filters.indexOf("FlateDecode") >= 0) {
      if (typeof inflate !== "function") throw new Error("inflate tidak tersedia");
      data = await inflate(rawBytes);
      data = undoPredictor(PDFLib, data, info);
    } else if (filters.length) {
      throw new Error("Filter tak didukung: " + filters.join("+"));
    }
    return samplesToRgba(data, info);
  }

  function numComponents(info) {
    const f = (info.colorSpace || {}).family;
    if (f === "rgb") return 3;
    if (f === "gray") return 1;
    if (f === "cmyk") return 4;
    if (f === "indexed") return 1;
    return 0;
  }

  // Kembalikan predictor (PNG/TIFF) pada data hasil inflate.
  function undoPredictor(PDFLib, data, info) {
    const N = PDFLib.PDFName;
    const parms = info.decodeParms;
    let predictor = 1;
    if (parms) {
      const pv = parms.get(N.of("Predictor"));
      if (pv && typeof pv.asNumber === "function") predictor = pv.asNumber();
    }
    if (predictor === 1) return data;
    const bpc = info.bitsPerComponent;
    let columns = info.width, colors = numComponents(info);
    if (parms) {
      const c = parms.get(N.of("Columns")); if (c && typeof c.asNumber === "function") columns = c.asNumber();
      const cc = parms.get(N.of("Colors")); if (cc && typeof cc.asNumber === "function") colors = cc.asNumber();
    }
    if (!columns || !colors || !bpc) throw new Error("parameter predictor tak lengkap");
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    if (predictor === 2) { // TIFF horizontal differencing (bpc 8)
      if (bpc !== 8) throw new Error("TIFF predictor butuh bpc 8");
      const out = new Uint8Array(data.length);
      for (let r = 0; r < info.height; r++) {
        for (let i = 0; i < rowLen; i++) {
          const prev = i >= colors ? out[r * rowLen + i - colors] : 0;
          out[r * rowLen + i] = (data[r * rowLen + i] + prev) & 255;
        }
      }
      return out;
    }
    if (predictor < 10 || predictor > 15) throw new Error("predictor tak didukung: " + predictor);
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const out = new Uint8Array(info.height * rowLen);
    let pos = 0;
    for (let r = 0; r < info.height; r++) {
      if (pos >= data.length) throw new Error("data predictor terpotong");
      const f = data[pos++];
      const row = data.subarray(pos, pos + rowLen); pos += rowLen;
      if (row.length < rowLen) throw new Error("baris predictor terpotong");
      const prev = r ? out.subarray((r - 1) * rowLen, r * rowLen) : null;
      const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
      unfilterRow(f, row, prev, cur, bpp, rowLen);
    }
    return out;
  }

  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  }

  function unfilterRow(f, row, prev, cur, bpp, len) {
    let i, a, b, c;
    if (f === 0) { cur.set(row); return; }
    if (f === 1) { for (i = 0; i < len; i++) { a = i >= bpp ? cur[i - bpp] : 0; cur[i] = (row[i] + a) & 255; } return; }
    if (f === 2) { for (i = 0; i < len; i++) { b = prev ? prev[i] : 0; cur[i] = (row[i] + b) & 255; } return; }
    if (f === 3) { for (i = 0; i < len; i++) { a = i >= bpp ? cur[i - bpp] : 0; b = prev ? prev[i] : 0; cur[i] = (row[i] + ((a + b) >> 1)) & 255; } return; }
    if (f === 4) { for (i = 0; i < len; i++) { a = i >= bpp ? cur[i - bpp] : 0; b = prev ? prev[i] : 0; c = (i >= bpp && prev) ? prev[i - bpp] : 0; cur[i] = (row[i] + paeth(a, b, c)) & 255; } return; }
    throw new Error("filter baris PNG tak dikenal: " + f);
  }

  // Sampel mentah -> RGBA. Mendukung gray/rgb/cmyk/indexed, bpc 1/2/4/8.
  function samplesToRgba(data, info) {
    const w = info.width, h = info.height, bpc = info.bitsPerComponent;
    const cs = info.colorSpace || { family: "unknown" };
    if (info.hasDecode) throw new Error("Decode array tak didukung");
    if (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8) throw new Error("bpc tak didukung: " + bpc);
    const n = w * h;
    const rgba = new Uint8ClampedArray(n * 4);
    if (cs.family === "indexed") {
      const pal = cs.palette, base = (cs.base || {}).family;
      const comps = base === "rgb" ? 3 : base === "gray" ? 1 : base === "cmyk" ? 4 : 0;
      if (!pal || !comps) throw new Error("palet indexed tak didukung");
      let bitpos = 0;
      for (let i = 0; i < n; i++) {
        const idx = readBits(data, bitpos, bpc); bitpos += bpc;
        if (idx > cs.hival) throw new Error("indeks palet di luar batas");
        const o = idx * comps, j = i * 4;
        if (base === "rgb") { rgba[j] = pal[o]; rgba[j + 1] = pal[o + 1]; rgba[j + 2] = pal[o + 2]; }
        else if (base === "gray") { const v = pal[o]; rgba[j] = rgba[j + 1] = rgba[j + 2] = v; }
        else { const q = cmykToRgb(pal[o] / 255, pal[o + 1] / 255, pal[o + 2] / 255, pal[o + 3] / 255); rgba[j] = q[0]; rgba[j + 1] = q[1]; rgba[j + 2] = q[2]; }
        rgba[j + 3] = 255;
      }
      return { width: w, height: h, rgba: rgba };
    }
    const comps = cs.family === "rgb" ? 3 : cs.family === "gray" ? 1 : cs.family === "cmyk" ? 4 : 0;
    if (!comps) throw new Error("ruang warna tak didukung: " + cs.family);
    const max = (1 << bpc) - 1;
    let bitpos = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      let r, g, b;
      if (comps === 1) { const v = Math.round(readBits(data, bitpos, bpc) * 255 / max); bitpos += bpc; r = g = b = v; }
      else if (comps === 3) {
        r = Math.round(readBits(data, bitpos, bpc) * 255 / max); bitpos += bpc;
        g = Math.round(readBits(data, bitpos, bpc) * 255 / max); bitpos += bpc;
        b = Math.round(readBits(data, bitpos, bpc) * 255 / max); bitpos += bpc;
      } else {
        const c = readBits(data, bitpos, bpc) / max; bitpos += bpc;
        const m = readBits(data, bitpos, bpc) / max; bitpos += bpc;
        const y = readBits(data, bitpos, bpc) / max; bitpos += bpc;
        const k = readBits(data, bitpos, bpc) / max; bitpos += bpc;
        const q = cmykToRgb(c, m, y, k); r = q[0]; g = q[1]; b = q[2];
      }
      rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = 255;
    }
    return { width: w, height: h, rgba: rgba };
  }

  function readBits(data, bitpos, bpc) {
    let v = 0;
    for (let i = 0; i < bpc; i++) {
      const p = bitpos + i;
      v = (v << 1) | ((data[p >> 3] >> (7 - (p & 7))) & 1);
    }
    return v;
  }

  function cmykToRgb(c, m, y, k) {
    return [
      Math.round(255 * (1 - Math.min(1, c * (1 - k) + k))),
      Math.round(255 * (1 - Math.min(1, m * (1 - k) + k))),
      Math.round(255 * (1 - Math.min(1, y * (1 - k) + k))),
    ];
  }

  /* ---------- samarkan (redact): cari teks & util rect (murni, bisa di-test) ---------- */

  // Bangun teks gabungan + peta indeks char -> indeks box (untuk pencarian).
  function buildTextMap(boxes) {
    let text = "";
    const map = [];
    boxes.forEach((b, bi) => {
      const s = String((b && b.str) || "");
      for (const ch of s) { text += ch; map.push(bi); }
      text += " "; map.push(-1);
    });
    return { text: text, map: map };
  }

  // Ubah rentang char -> {rect, text, parts} (teks yang cocok, spasi dirapikan).
  // parts = tight-box per item teks (untuk render presisi per kata).
  function matchToRectText(boxes, tm, start, end) {
    const involved = [];
    const seen = {};
    for (let i = start; i < end; i++) {
      const bi = tm.map[i];
      if (bi >= 0 && !seen[bi]) { seen[bi] = 1; involved.push(boxes[bi]); }
    }
    if (!involved.length) return null;
    const r = unionRects(involved);
    const text = tm.text.slice(start, end).replace(/\s+/g, " ").trim();
    const parts = involved.map((b) => ({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }));
    return { x: r.x, y: r.y, w: r.w, h: r.h, text: text, parts: parts };
  }

  // Snap sebuah rect ke item teks yang bersinggungan: kembalikan daftar
  // tight-box per item (atau null bila tidak ada teks di bawahnya — mis. area gambar).
  function snapToTextBoxes(textBoxes, rect, pad) {
    if (!Array.isArray(textBoxes) || !rect) return null;
    const p = pad == null ? 1 : pad;
    const out = [];
    for (const b of textBoxes) {
      if (!b.str || !b.str.trim()) continue;
      if (rectsOverlap(b, rect)) {
        out.push({ x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2, text: String(b.str).trim() });
      }
    }
    return out.length ? out : null;
  }

  // boxes: [{str, x, y, w, h}] dalam satu sistem koordinat.
  // Mengembalikan daftar kecocokan {x,y,w,h,text} per kemunculan query
  // (case-insensitive, cocok lintas item teks yang terpecah).
  function findTextMatches(boxes, query) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q || !Array.isArray(boxes) || !boxes.length) return [];
    const tm = buildTextMap(boxes);
    const t = tm.text.toLowerCase();
    const out = [];
    let from = 0;
    while (true) {
      const idx = t.indexOf(q, from);
      if (idx < 0) break;
      const m = matchToRectText(boxes, tm, idx, idx + q.length);
      if (m) out.push(m);
      from = idx + q.length;
    }
    return out;
  }

  // Versi ringkas: hanya rect (kompatibel lama).
  function findTextRects(boxes, query) {
    return findTextMatches(boxes, query).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h }));
  }

  // Sama seperti findTextMatches, tapi dengan RegExp (untuk deteksi pola sensitif).
  function findPatternMatches(boxes, pattern) {
    if (!Array.isArray(boxes) || !boxes.length || !pattern) return [];
    const tm = buildTextMap(boxes);
    const flags = pattern.flags.indexOf("g") >= 0 ? pattern.flags : pattern.flags + "g";
    const re = new RegExp(pattern.source, flags);
    const out = [];
    let m;
    while ((m = re.exec(tm.text)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const r = matchToRectText(boxes, tm, m.index, m.index + m[0].length);
      if (r) out.push(r);
    }
    return out;
  }

  // Versi ringkas: hanya rect (kompatibel lama).
  function findPatternRects(boxes, pattern) {
    return findPatternMatches(boxes, pattern).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h }));
  }

  // Apakah dua rect bersinggungan?
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Ambil teks di bawah sebuah rect (untuk kotak manual): gabung teks item yang bersinggungan.
  function textUnderRect(textBoxes, rect, maxLen) {
    if (!Array.isArray(textBoxes) || !rect) return "";
    const hits = textBoxes.filter((b) => rectsOverlap(b, rect));
    hits.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let s = hits.map((b) => b.str).join(" ").replace(/\s+/g, " ").trim();
    const ml = maxLen && maxLen > 0 ? maxLen : 120;
    if (s.length > ml) s = s.slice(0, ml) + "…";
    return s;
  }

  // Gabungkan beberapa rect jadi satu pembungkus.
  function unionRects(rs) {
    let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of rs) {
      if (r.x < x) x = r.x;
      if (r.y < y) y = r.y;
      if (r.x + r.w > x2) x2 = r.x + r.w;
      if (r.y + r.h > y2) y2 = r.y + r.h;
    }
    if (x === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x, y: y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
  }

  // Normalisasi rect hasil drag (pastikan w,h >= 0).
  function normRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  // Kalikan dua matriks transformasi 2D [a,b,c,d,e,f] (ala pdfjsLib.Util.transform).
  function mulTransform(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  /* ---------- preset satu-klik (murni, bisa di-test) ---------- */

  // key -> {quality, optimize}. Dipakai tombol preset di panel Gabung.
  var PRESETS = {
    wa:    { quality: "rendah", optimize: true,  label: "Buat WA" },
    email: { quality: "sedang", optimize: true,  label: "Buat Email" },
    max:   { quality: "asli",   optimize: true,  label: "Kualitas Maksimal" },
  };
  function presetConfig(key) {
    var p = PRESETS[key];
    return p ? { quality: p.quality, optimize: p.optimize } : null;
  }
  function presetKeys() { return Object.keys(PRESETS); }

  /* ---------- riwayat lokal (murni, bisa di-test) ---------- */

  var HISTORY_MAX = 10;
  // Tambah item ke depan daftar, batasi maksimal. Mengembalikan array BARU.
  // item: {name, date (ISO string), sizeBytes, pageCount, quality}
  function pushHistory(list, item, max) {
    var m = max && max > 0 ? Math.floor(max) : HISTORY_MAX;
    var arr = Array.isArray(list) ? list.slice() : [];
    arr.unshift({
      name: String(item && item.name != null ? item.name : "tanpa nama"),
      date: String(item && item.date != null ? item.date : new Date().toISOString()),
      sizeBytes: Math.max(0, Math.floor(Number(item && item.sizeBytes) || 0)),
      pageCount: Math.max(0, Math.floor(Number(item && item.pageCount) || 0)),
      quality: String(item && item.quality != null ? item.quality : ""),
    });
    return arr.slice(0, m);
  }


      /* ---------- atur halaman ---------- */

  // Normalisasi derajat rotasi ke 0..359.
  function normalizeRotation(deg) {
    const d = Math.round(Number(deg) || 0) % 360;
    return (d + 360) % 360;
  }

  // state: [{src: 0-based, rot, deleted}] -> plan [{src: 1-based, rotation}].
  function planFromPages(state) {
    const plan = [];
    for (const p of state || []) {
      if (p.deleted) continue;
      plan.push({ src: (Number(p.src) || 0) + 1, rotation: normalizeRotation(p.rot) });
    }
    return plan;
  }

  // plan: [{src: 1-based, rotation}] -> PDF baru (halaman disalin sesuai urutan + rotasi).
  async function applyPagePlan(PDFLib, srcBytes, plan) {
    const src = await PDFLib.PDFDocument.load(srcBytes);
    const out = await PDFLib.PDFDocument.create();
    for (const item of plan || []) {
      const i = (Number(item.src) || 0) - 1;
      if (i < 0 || i >= src.getPageCount()) continue;
      const cp = (await out.copyPages(src, [i]))[0];
      const rot = normalizeRotation(item.rotation);
      if (rot) {
        const cur = src.getPage(i).getRotation().angle;
        cp.setRotation(PDFLib.degrees((cur + rot) % 360));
      }
      out.addPage(cp);
    }
    return out.save({ useObjectStreams: true });
  }

  /* ---------- watermark ---------- */

  // Titik awal baseline agar teks (lebar tw, tinggi th, sudut deg) berpusat di (cx, cy).
  function centeredTextPoint(cx, cy, tw, th, angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    const vx = -Math.sin(a), vy = Math.cos(a);
    return {
      x: cx - (tw / 2) * ux - (th / 2) * vx,
      y: cy - (tw / 2) * uy - (th / 2) * vy,
    };
  }

  // Posisi watermark dalam koordinat PDF (origin kiri-bawah).
  // mode "center": satu titik tengah. mode "tile": grid berulang.
  function watermarkPositions(pageW, pageH, text, fontSize, angleDeg, mode) {
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    const tw = Math.max(10, String(text || "").length * fontSize * 0.55);
    const th = fontSize;
    const bw = tw * cos + th * sin;
    const bh = tw * sin + th * cos;
    if (mode === "tile") {
      const stepX = bw + 90, stepY = bh + 90;
      const out = [];
      for (let y = stepY / 2; y < pageH + bh; y += stepY) {
        for (let x = stepX / 2; x < pageW + bw; x += stepX) {
          out.push({ x: x, y: y });
        }
      }
      return out;
    }
    return [{ x: pageW / 2, y: pageH / 2 }];
  }

  // opts: {text, size, opacity, angle, color:[r,g,b], mode:'center'|'tile'}
  async function applyWatermark(PDFLib, srcBytes, opts) {
    const o = opts || {};
    const doc = await PDFLib.PDFDocument.load(srcBytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const text = String(o.text == null ? "" : o.text).trim() || "RAHASIA";
    const size = Math.max(8, Math.min(200, Number(o.size) || 48));
    const opacity = Math.max(0.05, Math.min(1, Number(o.opacity) || 0.3));
    const angle = Number(o.angle) || 0;
    const mode = o.mode === "tile" ? "tile" : "center";
    const col = Array.isArray(o.color) && o.color.length === 3 ? o.color : [0.5, 0.5, 0.5];
    const tw = font.widthOfTextAtSize(text, size);
    for (const pg of doc.getPages()) {
      const sz = pg.getSize();
      const pts = watermarkPositions(sz.width, sz.height, text, size, angle, mode);
      for (const pt of pts) {
        const p = centeredTextPoint(pt.x, pt.y, tw, size, angle);
        pg.drawText(text, {
          x: p.x, y: p.y, size: size, font: font,
          color: PDFLib.rgb(col[0], col[1], col[2]),
          opacity: opacity, rotate: PDFLib.degrees(angle),
        });
      }
    }
    return doc.save({ useObjectStreams: true });
  }

  /* ---------- tanda tangan ---------- */

  // Rect tanda tangan (koordinat PDF, origin kiri-bawah) dari ukuran gambar & posisi.
  // Tinggi dibatasi (tanda tangan vertikal tidak boleh jadi raksasa).
  function signatureRect(pageW, pageH, imgW, imgH, pos, width, margin) {
    const m = margin == null ? 36 : Number(margin) || 0;
    let w = Math.max(20, Math.min(pageW - m * 2, Number(width) || 150));
    let h = Math.max(10, (w * imgH) / Math.max(1, imgW));
    if (h > 150) { h = 150; w = Math.max(20, (h * imgW) / Math.max(1, imgH)); }
    let x = m;
    if (pos === "center") x = (pageW - w) / 2;
    else if (pos === "right") x = pageW - w - m;
    return { x: x, y: m, w: w, h: h };
  }

  // opts: {page: 1-based, rect:{x,y,w,h}} atau {page, pos, width, margin}
  async function applySignature(PDFLib, srcBytes, pngBytes, opts) {
    const o = opts || {};
    const doc = await PDFLib.PDFDocument.load(srcBytes);
    const img = await doc.embedPng(pngBytes);
    const n = Math.max(1, Math.min(doc.getPageCount(), Number(o.page) || 1));
    const pg = doc.getPage(n - 1);
    const sz = pg.getSize();
    let r;
    if (o.rect && Number(o.rect.w) > 0 && Number(o.rect.h) > 0) {
      r = {
        x: Math.max(0, Math.min(sz.width - 1, Number(o.rect.x) || 0)),
        y: Math.max(0, Math.min(sz.height - 1, Number(o.rect.y) || 0)),
        w: Math.max(1, Math.min(sz.width, Number(o.rect.w))),
        h: Math.max(1, Math.min(sz.height, Number(o.rect.h))),
      };
    } else {
      r = signatureRect(sz.width, sz.height, img.width, img.height, o.pos || "right", o.width || 150, o.margin == null ? 36 : o.margin);
    }
    pg.drawImage(img, { x: r.x, y: r.y, width: r.w, height: r.h });
    return doc.save({ useObjectStreams: true });
  }

  /* ---------- PDF ke gambar ---------- */

  // Nama file gambar hasil: "dokumen" + halaman 1 dari 12 -> "dokumen-01.jpg"
  function imageFileName(base, n, total, ext) {
    let b = String(base == null ? "" : base).trim().replace(/\.pdf$/i, "") || "dokumen";
    const digits = String(Math.max(1, Number(total) || 1)).length;
    const num = String(Math.max(1, Number(n) || 1)).padStart(digits, "0");
    return b + "-" + num + "." + (ext || "jpg");
  }


  return {
    resolveFileName: resolveFileName,
    fmtSize: fmtSize,
    parseRanges: parseRanges,
    chunkEveryN: chunkEveryN,
    splitName: splitName,
    buildPdf: buildPdf,
    applyPageNumbers: applyPageNumbers,
    buildSplit: buildSplit,
    presetConfig: presetConfig,
    presetKeys: presetKeys,
    pushHistory: pushHistory,
    HISTORY_MAX: HISTORY_MAX,
    listImageXObjects: listImageXObjects,
    decodeImagePixels: decodeImagePixels,
    findTextRects: findTextRects,
    findPatternRects: findPatternRects,
    findTextMatches: findTextMatches,
    findPatternMatches: findPatternMatches,
    rectsOverlap: rectsOverlap,
    textUnderRect: textUnderRect,
    snapToTextBoxes: snapToTextBoxes,
    unionRects: unionRects,
    normRect: normRect,
    mulTransform: mulTransform,
    normalizeRotation: normalizeRotation,
    planFromPages: planFromPages,
    applyPagePlan: applyPagePlan,
    centeredTextPoint: centeredTextPoint,
    watermarkPositions: watermarkPositions,
    applyWatermark: applyWatermark,
    signatureRect: signatureRect,
    applySignature: applySignature,
    imageFileName: imageFileName,
  };
});
