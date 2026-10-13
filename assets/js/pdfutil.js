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
  };
});
