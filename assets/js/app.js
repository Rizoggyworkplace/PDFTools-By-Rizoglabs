/* PDF Tools — 100% client-side. Tidak ada upload, tidak ada server. */
(function () {
  "use strict";

  // pdf.js worker (versi dipin di index.html)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone"), fileInput = $("fileInput"), pickBtn = $("pickBtn");
  const grid = $("grid"), toolbar = $("toolbar"), actionBar = $("actionBar");
  const emptyHint = $("emptyHint"), statText = $("statText"), mergeBtn = $("mergeBtn");
  const mergeCount = $("mergeCount"), toastEl = $("toast");

  let pages = [];       // {uid,fileUid,fileName,kind:'pdf'|'img',pageNum,pdfBytes,imgDataUrl,thumbUrl,included}
  let files = [];       // {uid,name}
  let uidSeq = 0;
  const uid = () => "p" + (++uidSeq) + "_" + Date.now().toString(36);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ---------- input ---------- */

  pickBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  async function addFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    let added = 0;
    for (const f of arr) {
      try {
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) await addPdf(f);
        else if (/^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) await addImage(f);
        else { toast("Lewati: " + f.name + " (bukan PDF/gambar)"); continue; }
        added++;
      } catch (err) {
        console.error(err);
        toast("Gagal baca: " + f.name);
      }
    }
    if (added) { render(); toast(added + " file ditambahkan"); }
  }

  async function addPdf(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const fileUid = uid(), fileName = file.name;
    files.push({ uid: fileUid, name: fileName });
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = 220 / vp0.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      pages.push({
        uid: uid(), fileUid, fileName, kind: "pdf",
        pageNum: n, pdfBytes: bytes, thumbUrl: canvas.toDataURL("image/jpeg", 0.72),
        included: true,
      });
      page.cleanup();
    }
    doc.destroy();
  }

  async function addImage(file) {
    const bmp = await loadBitmap(file);
    const MAX = 2000;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // WebP/PNG transparan -> putih
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    const tw = 220, ts = tw / w;
    const tc = document.createElement("canvas");
    tc.width = tw; tc.height = Math.max(1, Math.round(h * ts));
    tc.getContext("2d").drawImage(canvas, 0, 0, tc.width, tc.height);

    const fileUid = uid();
    files.push({ uid: fileUid, name: file.name });
    pages.push({
      uid: uid(), fileUid, fileName: file.name, kind: "img",
      pageNum: 1, imgDataUrl: dataUrl, thumbUrl: tc.toDataURL("image/jpeg", 0.72),
      included: true,
    });
  }

  function loadBitmap(file) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(file, { imageOrientation: "fromImage" }).catch(() => fallbackImage(file));
    }
    return fallbackImage(file);
  }
  function fallbackImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }

  /* ---------- render grid ---------- */

  function render() {
    grid.innerHTML = "";
    const has = pages.length > 0;
    toolbar.hidden = !has; actionBar.hidden = !has; emptyHint.style.display = has ? "none" : "";
    const inc = pages.filter((p) => p.included).length;
    statText.textContent = pages.length + " halaman · " + inc + " dipilih";
    mergeCount.textContent = inc ? "(" + inc + ")" : "";
    mergeBtn.disabled = inc === 0;

    pages.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "page-card " + (p.included ? "included" : "excluded");
      card.draggable = true;
      card.dataset.uid = p.uid;

      const img = document.createElement("img");
      img.className = "thumb"; img.src = p.thumbUrl; img.alt = p.fileName + " hal " + p.pageNum;
      img.draggable = false;
      card.appendChild(img);

      const num = document.createElement("div");
      num.className = "page-num"; num.textContent = idx + 1;
      card.appendChild(num);

      const badge = document.createElement("div");
      badge.className = "badge-ex"; badge.textContent = "lewati";
      card.appendChild(badge);

      const check = document.createElement("div");
      check.className = "check"; check.textContent = "✓";
      card.appendChild(check);

      const movers = document.createElement("div");
      movers.className = "movers";
      const bl = document.createElement("button");
      bl.type = "button"; bl.textContent = "◀"; bl.title = "Geser kiri"; bl.setAttribute("aria-label", "Geser kiri");
      bl.addEventListener("click", (e) => { e.stopPropagation(); movePage(p.uid, -1); });
      const br = document.createElement("button");
      br.type = "button"; br.textContent = "▶"; br.title = "Geser kanan"; br.setAttribute("aria-label", "Geser kanan");
      br.addEventListener("click", (e) => { e.stopPropagation(); movePage(p.uid, 1); });
      movers.appendChild(bl); movers.appendChild(br);
      card.appendChild(movers);

      const meta = document.createElement("div");
      meta.className = "page-meta";
      meta.textContent = p.fileName + (p.kind === "pdf" ? " · hal " + p.pageNum : " · gambar");
      meta.title = p.fileName;
      card.appendChild(meta);

      card.addEventListener("click", () => { p.included = !p.included; render(); });

      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", p.uid);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); clearDropTargets(); });
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const fromUid = e.dataTransfer.getData("text/plain");
        if (fromUid && fromUid !== p.uid) movePageTo(fromUid, p.uid);
      });

      grid.appendChild(card);
    });
  }

  function clearDropTargets() {
    grid.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  }
  function movePage(uidV, dir) {
    const i = pages.findIndex((p) => p.uid === uidV);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= pages.length) return;
    const [p] = pages.splice(i, 1);
    pages.splice(j, 0, p);
    render();
  }
  function movePageTo(fromUid, toUid) {
    const i = pages.findIndex((p) => p.uid === fromUid);
    const j = pages.findIndex((p) => p.uid === toUid);
    if (i < 0 || j < 0) return;
    const [p] = pages.splice(i, 1);
    pages.splice(j, 0, p);
    render();
  }

  $("selectAllBtn").addEventListener("click", () => { pages.forEach((p) => (p.included = true)); render(); });
  $("deselectAllBtn").addEventListener("click", () => { pages.forEach((p) => (p.included = false)); render(); });
  $("clearBtn").addEventListener("click", () => {
    if (!pages.length) return;
    if (confirm("Hapus semua file dan halaman?")) { pages = []; files = []; render(); }
  });

  /* ---------- merge & download ---------- */

  mergeBtn.addEventListener("click", async () => {
    const chosen = pages.filter((p) => p.included);
    if (!chosen.length) { toast("Pilih dulu halamannya"); return; }
    mergeBtn.disabled = true;
    const oldLabel = mergeBtn.innerHTML;
    mergeBtn.innerHTML = "⏳ Menggabung…";
    try {
      const bytes = await buildPdf(chosen);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pdf-tools-gabungan-" + stamp() + ".pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Berhasil! " + chosen.length + " halaman digabung.");
    } catch (err) {
      console.error(err);
      toast("Gagal menggabung: " + (err && err.message ? err.message : err));
    }
    mergeBtn.innerHTML = oldLabel;
    mergeBtn.disabled = false;
  });

  async function buildPdf(chosen) {
    const out = await PDFLib.PDFDocument.create();
    const cache = new Map(); // fileUid -> PDFLib.PDFDocument
    for (const p of chosen) {
      if (p.kind === "pdf") {
        let src = cache.get(p.fileUid);
        if (!src) { src = await PDFLib.PDFDocument.load(p.pdfBytes); cache.set(p.fileUid, src); }
        const [cp] = await out.copyPages(src, [p.pageNum - 1]);
        out.addPage(cp);
      } else {
        const jpg = await out.embedJpg(p.imgDataUrl);
        const pg = out.addPage([jpg.width, jpg.height]);
        pg.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
      }
    }
    return await out.save();
  }

  function stamp() {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes());
  }

  if (!window.pdfjsLib || !window.PDFLib) {
    toast("Gagal memuat library (butuh internet untuk CDN).");
  }
})();
