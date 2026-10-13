/* PDF Tools — 100% client-side. Tidak ada upload, tidak ada server. */
(function () {
  "use strict";

  // pdf.js worker (versi dipin di index.html)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }

  const U = window.PdfUtil; // assets/js/pdfutil.js (util murni, tanpa DOM)

  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone"), fileInput = $("fileInput"), pickBtn = $("pickBtn");
  const fileList = $("fileList"), toolbar = $("toolbar"), actionBar = $("actionBar");
  const emptyHint = $("emptyHint"), statText = $("statText"), mergeBtn = $("mergeBtn");
  const mergeCount = $("mergeCount"), toastEl = $("toast");
  const fileNameInput = $("fileNameInput"), optimizeCheck = $("optimizeCheck");
  const resultInfo = $("resultInfo"), qualityNote = $("qualityNote");
  const pageNumCheck = $("pageNumCheck"), pageNumPos = $("pageNumPos");

  let pages = [];       // {uid,fileUid,fileName,kind:'pdf'|'img',pageNum,pdfBytes,imgDataUrl,thumbUrl,included,rotation}
  let files = [];       // {uid,name,expanded} — urutan array = urutan gabung
  let uidSeq = 0;
  const uid = () => "p" + (++uidSeq) + "_" + Date.now().toString(36);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function iconBtn(label, title, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "icon-btn";
    b.innerHTML = '<span class="msr">' + label + '</span>'; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  /* ---------- tab Gabung / Pisah ---------- */

  const tabMerge = $("tabMerge"), tabSplit = $("tabSplit");
  const paneMerge = $("paneMerge"), paneSplit = $("paneSplit");
  tabMerge.addEventListener("click", () => switchTab(true));
  tabSplit.addEventListener("click", () => switchTab(false));
  function switchTab(merge) {
    tabMerge.classList.toggle("active", merge);
    tabSplit.classList.toggle("active", !merge);
    paneMerge.hidden = !merge;
    paneSplit.hidden = merge;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- input (mode gabung) ---------- */

  pickBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  async function addFiles(fileList_) {
    const arr = Array.from(fileList_ || []);
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
    files.push({ uid: fileUid, name: fileName, expanded: false });
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
        included: true, rotation: 0,
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
    files.push({ uid: fileUid, name: file.name, expanded: false });
    pages.push({
      uid: uid(), fileUid, fileName: file.name, kind: "img",
      pageNum: 1, imgDataUrl: dataUrl, thumbUrl: tc.toDataURL("image/jpeg", 0.72),
      included: true, rotation: 0,
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
  function loadImageFromUrl(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }

  // Putar sumber gambar (canvas/ImageBitmap) sebesar deg searah jarum jam.
  function drawRotated(src, srcW, srcH, deg, quality) {
    const swap = deg === 90 || deg === 270;
    const c = document.createElement("canvas");
    c.width = swap ? srcH : srcW;
    c.height = swap ? srcW : srcH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -srcW / 2, -srcH / 2, srcW, srcH);
    return c.toDataURL("image/jpeg", quality);
  }

  /* ---------- model ---------- */

  function filePages(fileUid) {
    return pages.filter((p) => p.fileUid === fileUid);
  }

  // Urutan gabung: file berurutan, tiap file -> halaman included sesuai urutan halamannya.
  function collectChosen() {
    const out = [];
    for (const f of files) {
      for (const p of pages) {
        if (p.fileUid === f.uid && p.included) out.push(p);
      }
    }
    return out;
  }

  function moveFile(uidV, dir) {
    const i = files.findIndex((f) => f.uid === uidV);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= files.length) return;
    const [f] = files.splice(i, 1);
    files.splice(j, 0, f);
    render();
  }
  function moveFileTo(fromUid, toUid) {
    if (fromUid === toUid) return;
    const a = files.find((f) => f.uid === fromUid);
    const b = files.find((f) => f.uid === toUid);
    if (!a || !b) return;
    files.splice(files.indexOf(a), 1);
    files.splice(files.indexOf(b), 0, a);
    render();
  }

  function movePageWithinFile(uidV, dir) {
    const p = pages.find((x) => x.uid === uidV);
    if (!p) return;
    const group = filePages(p.fileUid);
    const i = group.findIndex((x) => x.uid === uidV);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const gi = pages.indexOf(group[i]), gj = pages.indexOf(group[j]);
    const tmp = pages[gi]; pages[gi] = pages[gj]; pages[gj] = tmp;
    render();
  }
  function movePageToWithinFile(fromUid, toUid) {
    if (fromUid === toUid) return;
    const a = pages.find((x) => x.uid === fromUid);
    const b = pages.find((x) => x.uid === toUid);
    if (!a || !b || a.fileUid !== b.fileUid) return;
    pages.splice(pages.indexOf(a), 1);
    pages.splice(pages.indexOf(b), 0, a);
    render();
  }

  /* ---------- render: daftar file ---------- */

  function render() {
    fileList.innerHTML = "";
    resultInfo.hidden = true; // info hasil merge terakhir tidak berlaku lagi bila daftar berubah
    const has = files.length > 0;
    toolbar.hidden = !has; actionBar.hidden = !has; emptyHint.style.display = has ? "none" : "";
    const inc = pages.filter((p) => p.included).length;
    statText.textContent = files.length + " file · " + pages.length + " halaman · " + inc + " dipilih";
    mergeCount.textContent = inc ? "(" + inc + ")" : "";
    mergeBtn.disabled = inc === 0;

    files.forEach((f, fIdx) => {
      const fps = filePages(f.uid);
      const fInc = fps.filter((p) => p.included).length;

      const card = document.createElement("div");
      card.className = "file-card";
      card.draggable = true;
      card.dataset.uid = f.uid;

      // --- header kartu file ---
      const head = document.createElement("div");
      head.className = "file-head";
      head.title = "Ketuk untuk lihat/sembunyikan halaman";

      const grip = document.createElement("span");
      grip.className = "drag-handle"; grip.textContent = "⋮⋮"; grip.title = "Seret untuk pindah urutan";

      const kind = document.createElement("span");
      const isImg = fps.length > 0 && fps[0].kind === "img";
      kind.className = "file-kind " + (isImg ? "kind-img" : "kind-pdf");
      kind.textContent = isImg ? "GAMBAR" : "PDF";

      const info = document.createElement("div");
      info.className = "file-info";
      const nm = document.createElement("div");
      nm.className = "file-name"; nm.textContent = f.name; nm.title = f.name;
      const sub = document.createElement("div");
      sub.className = "file-sub";
      sub.textContent = "Urutan " + (fIdx + 1) + " · " + fps.length + " halaman · " + fInc + " dipilih";
      info.appendChild(nm); info.appendChild(sub);

      const movers = document.createElement("div");
      movers.className = "file-movers";
      movers.appendChild(iconBtn("arrow_upward", "Pindah ke atas", () => moveFile(f.uid, -1)));
      movers.appendChild(iconBtn("arrow_downward", "Pindah ke bawah", () => moveFile(f.uid, 1)));

      const exp = document.createElement("span");
      exp.className = "expand-ind"; exp.innerHTML = '<span class="msr">' + (f.expanded ? "expand_more" : "chevron_right") + '</span>';

      const rm = iconBtn("close", "Hapus file ini", () => {
        pages = pages.filter((p) => p.fileUid !== f.uid);
        files = files.filter((x) => x.uid !== f.uid);
        render();
        toast("File dihapus: " + f.name);
      });
      rm.classList.add("file-remove");

      head.appendChild(grip); head.appendChild(kind); head.appendChild(info); head.appendChild(movers);
      head.appendChild(exp); head.appendChild(rm);
      card.appendChild(head);

      head.addEventListener("click", () => { f.expanded = !f.expanded; render(); });

      // drag & drop antar file
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", "file:" + f.uid);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); clearDropTargets(); });
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("text/plain");
        if (raw && raw.indexOf("file:") === 0) moveFileTo(raw.slice(5), f.uid);
      });

      // --- halaman (expand) ---
      const pgWrap = document.createElement("div");
      pgWrap.className = "file-pages";
      pgWrap.hidden = !f.expanded;
      if (f.expanded) {
        const grid = document.createElement("div");
        grid.className = "grid";
        fps.forEach((p) => grid.appendChild(pageCard(p)));
        pgWrap.appendChild(grid);
      }
      card.appendChild(pgWrap);

      fileList.appendChild(card);
    });
  }

  function clearDropTargets() {
    fileList.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  }

  /* ---------- render: kartu halaman (di dalam file yang di-expand) ---------- */

  function pageCard(p) {
    const card = document.createElement("div");
    card.className = "page-card " + (p.included ? "included" : "excluded");
    card.draggable = true;
    card.dataset.uid = p.uid;

    const img = document.createElement("img");
    img.className = "thumb"; img.src = p.thumbUrl; img.alt = p.fileName + " hal " + p.pageNum;
    img.draggable = false;
    card.appendChild(img);

    const badge = document.createElement("div");
    badge.className = "badge-ex"; badge.textContent = "lewati";
    card.appendChild(badge);

    const rotBadge = document.createElement("div");
    rotBadge.className = "rot-badge" + (p.rotation ? " on" : "");
    rotBadge.innerHTML = p.rotation ? '<span class="msr">rotate_right</span>' + p.rotation + "°" : "";
    card.appendChild(rotBadge);

    const check = document.createElement("div");
    check.className = "check"; check.innerHTML = '<span class="msr">check</span>';
    card.appendChild(check);

    const movers = document.createElement("div");
    movers.className = "movers";
    movers.appendChild(iconBtn("arrow_back", "Geser kiri", () => movePageWithinFile(p.uid, -1)));
    movers.appendChild(iconBtn("arrow_forward", "Geser kanan", () => movePageWithinFile(p.uid, 1)));
    movers.appendChild(iconBtn("rotate_90_degrees_cw", "Putar 90°", () => {
      p.rotation = ((p.rotation || 0) + 90) % 360;
      render();
    }));
    card.appendChild(movers);

    const meta = document.createElement("div");
    meta.className = "page-meta";
    meta.innerHTML = (p.kind === "pdf" ? "Hal " + p.pageNum : "gambar") + (p.rotation ? ' · <span class="msr">rotate_right</span>' + p.rotation + "°" : "");
    card.appendChild(meta);

    card.addEventListener("click", (e) => { e.stopPropagation(); p.included = !p.included; render(); });

    // drag page hanya di dalam file yang sama — jangan sampai bubble ke kartu file
    card.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.setData("text/plain", "page:" + p.uid);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", (e) => { e.stopPropagation(); card.classList.remove("dragging"); clearDropTargets(); });
    card.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); card.classList.add("drop-target"); });
    card.addEventListener("dragleave", (e) => { e.stopPropagation(); card.classList.remove("drop-target"); });
    card.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      const raw = e.dataTransfer.getData("text/plain");
      if (raw && raw.indexOf("page:") === 0) movePageToWithinFile(raw.slice(5), p.uid);
    });

    return card;
  }

  $("selectAllBtn").addEventListener("click", () => { pages.forEach((p) => (p.included = true)); render(); });
  $("deselectAllBtn").addEventListener("click", () => { pages.forEach((p) => (p.included = false)); render(); });
  $("clearBtn").addEventListener("click", () => {
    if (!files.length) return;
    if (confirm("Hapus semua file dan halaman?")) { pages = []; files = []; render(); }
  });

  /* ---------- kualitas hasil ---------- */

  const LOSSY = {
    tinggi: { dpi: 200, q: 0.85, maxImg: 2200 },
    sedang: { dpi: 150, q: 0.70, maxImg: 1600 },
    rendah: { dpi: 96,  q: 0.55, maxImg: 1100 },
  };
  function selectedQuality() {
    const el = document.querySelector('input[name="quality"]:checked');
    return el ? el.value : "asli";
  }
  document.querySelectorAll('input[name="quality"]').forEach((el) => {
    el.addEventListener("change", () => {
      qualityNote.hidden = selectedQuality() === "asli";
    });
  });

  /* ---------- merge & download ---------- */

  mergeBtn.addEventListener("click", async () => {
    const chosen = collectChosen();
    if (!chosen.length) { toast("Pilih dulu halamannya"); return; }
    const quality = selectedQuality();
    mergeBtn.disabled = true;
    const oldLabel = mergeBtn.innerHTML;
    mergeBtn.innerHTML = quality === "asli" ? "⏳ Menggabung…" : "⏳ Meraster halaman…";
    resultInfo.hidden = true;
    try {
      const fileName = U.resolveFileName(fileNameInput.value);
      const optimize = optimizeCheck.checked;
      const pageNumbers = pageNumCheck.checked;
      const pageNumPosVal = pageNumPos.value;
      let bytes, plainBytes = null, srcBytes = 0;

      if (quality === "asli") {
        // Halaman gambar yang diputar di-bake dulu via canvas (PDF pakai rotasi native).
        const prepared = await prepareChosen(chosen);
        const r = await U.buildPdf(PDFLib, prepared, { optimize: optimize, pageNumbers: pageNumbers, pageNumPos: pageNumPosVal });
        bytes = r.bytes; plainBytes = r.plainBytes;
      } else {
        const preset = LOSSY[quality];
        const r = await buildLossyPdf(chosen, preset, pageNumbers, pageNumPosVal);
        bytes = r.bytes;
        srcBytes = chosen.reduce((s, p) => s + (p.pdfBytes ? p.pdfBytes.length : Math.round((p.imgDataUrl.length * 3) / 4)), 0);
      }

      saveSettings();

      let info = "Ukuran hasil: " + U.fmtSize(bytes.length);
      const base = plainBytes || (srcBytes > 0 ? { length: srcBytes } : null);
      if (base && base.length > bytes.length) {
        const hemat = Math.round((1 - bytes.length / base.length) * 100);
        info += " (sebelumnya ±" + U.fmtSize(base.length) + " · hemat " + hemat + "%)";
      }
      resultInfo.textContent = info;
      resultInfo.hidden = false;
      addHistory({
        name: fileName,
        date: new Date().toISOString(),
        sizeBytes: bytes.length,
        pageCount: chosen.length,
        quality: quality,
      });

      // pratinjau sebelum download
      const blob = new Blob([bytes], { type: "application/pdf" });
      const frame = document.createElement("iframe");
      frame.title = "Pratinjau " + fileName;
      openPreview({
        title: "Pratinjau hasil gabungan",
        sub: fileName + " · " + info + " · " + chosen.length + " halaman",
        bodyNode: frame,
        blob: blob,
        fileName: fileName,
        downloadLabel: '<span class="msr">download</span> Download PDF',
      });
      toast("Berhasil! " + chosen.length + " halaman digabung.");
    } catch (err) {
      console.error(err);
      toast("Gagal menggabung: " + (err && err.message ? err.message : err));
    }
    mergeBtn.innerHTML = oldLabel;
    mergeBtn.disabled = false;
  });

  // Untuk mode "Asli": rotasi halaman gambar di-bake via canvas (q=1.0),
  // halaman PDF memakai rotasi native pdf-lib di PdfUtil.buildPdf.
  async function prepareChosen(chosen) {
    const out = [];
    for (const p of chosen) {
      if (p.kind === "img" && p.rotation) {
        const img = await loadImageFromUrl(p.imgDataUrl);
        const dataUrl = drawRotated(img, img.naturalWidth, img.naturalHeight, p.rotation, 1.0);
        out.push(Object.assign({}, p, { imgDataUrl: dataUrl, rotation: 0 }));
      } else {
        out.push(p);
      }
    }
    return out;
  }

  // Mode lossy: tiap halaman di-raster via pdf.js/canvas -> JPEG, lalu dirakit ulang.
  async function buildLossyPdf(chosen, preset, pageNumbers, pageNumPos) {
    const out = await PDFLib.PDFDocument.create();
    for (const p of chosen) {
      const dataUrl = await rasterizePage(p, preset);
      const jpg = await out.embedJpg(dataUrl);
      const pg = out.addPage([jpg.width, jpg.height]);
      pg.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    }
    if (pageNumbers) await U.applyPageNumbers(PDFLib, out, pageNumPos);
    const bytes = await out.save({ useObjectStreams: true });
    return { bytes: bytes };
  }

  async function rasterizePage(p, preset) {
    let canvas;
    if (p.kind === "pdf") {
      const doc = await pdfjsLib.getDocument({ data: p.pdfBytes.slice() }).promise;
      try {
        const page = await doc.getPage(p.pageNum);
        const vp = page.getViewport({ scale: preset.dpi / 72 });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
      } finally {
        doc.destroy();
      }
    } else {
      const img = await loadImageFromUrl(p.imgDataUrl);
      const s = Math.min(1, preset.maxImg / Math.max(img.naturalWidth, img.naturalHeight));
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    if (p.rotation) {
      return drawRotated(canvas, canvas.width, canvas.height, p.rotation, preset.q);
    }
    return canvas.toDataURL("image/jpeg", preset.q);
  }

  /* ---------- mode pisah ---------- */

  const splitDropzone = $("splitDropzone"), splitFileInput = $("splitFileInput");
  const splitPickBtn = $("splitPickBtn"), splitWork = $("splitWork");
  const splitFileName = $("splitFileName"), splitPageCount = $("splitPageCount");
  const rangeInput = $("rangeInput"), everyNInput = $("everyNInput");
  const splitBaseName = $("splitBaseName"), splitBtn = $("splitBtn");
  const splitResultInfo = $("splitResultInfo");

  let splitDoc = null; // {name, bytes, numPages}

  splitPickBtn.addEventListener("click", (e) => { e.stopPropagation(); splitFileInput.click(); });
  splitDropzone.addEventListener("click", () => splitFileInput.click());
  splitFileInput.addEventListener("change", () => { loadSplitFile(splitFileInput.files[0]); splitFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    splitDropzone.addEventListener(ev, (e) => { e.preventDefault(); splitDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    splitDropzone.addEventListener(ev, (e) => { e.preventDefault(); splitDropzone.classList.remove("dragover"); }));
  splitDropzone.addEventListener("drop", (e) => loadSplitFile(e.dataTransfer.files[0]));

  async function loadSplitFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) {
      toast("Pilih file PDF");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      doc.destroy();
      splitDoc = { name: file.name, bytes: bytes, numPages: n };
      splitFileName.textContent = file.name;
      splitPageCount.textContent = n + " halaman";
      splitBaseName.value = file.name.replace(/\.pdf$/i, "") || "dokumen";
      splitWork.hidden = false;
      splitResultInfo.hidden = true;
      toast("PDF dimuat: " + n + " halaman");
    } catch (err) {
      console.error(err);
      toast("Gagal baca PDF");
    }
  }

  function splitMode() {
    const el = document.querySelector('input[name="splitMode"]:checked');
    return el ? el.value : "range";
  }

  splitBtn.addEventListener("click", async () => {
    if (!splitDoc) { toast("Pilih dulu file PDF-nya"); return; }
    if (!window.JSZip) { toast("Gagal memuat JSZip (butuh internet untuk CDN)."); return; }
    const mode = splitMode();
    let ranges;
    try {
      if (mode === "range") ranges = U.parseRanges(rangeInput.value, splitDoc.numPages);
      else if (mode === "every") ranges = U.chunkEveryN(splitDoc.numPages, everyNInput.value);
      else ranges = U.chunkEveryN(splitDoc.numPages, 1);
    } catch (err) {
      toast(err.message);
      return;
    }
    splitBtn.disabled = true;
    const oldLabel = splitBtn.innerHTML;
    splitBtn.innerHTML = "⏳ Memisah…";
    splitResultInfo.hidden = true;
    try {
      const parts = await U.buildSplit(PDFLib, splitDoc.bytes, ranges, { optimize: true });
      const zip = new JSZip();
      const base = splitBaseName.value.trim() || "dokumen";
      let total = 0;
      for (const part of parts) {
        const name = U.splitName(base, part.label);
        zip.file(name, part.bytes);
        total += part.bytes.length;
      }
      const zipName = U.resolveFileName(base + "_pisah").replace(/\.pdf$/i, "") + ".zip";
      const blob = await zip.generateAsync({ type: "blob" });
      splitResultInfo.textContent = parts.length + " file dibuat (" +
        parts.map((x) => x.label).join(", ") + ") · total " + U.fmtSize(total);
      splitResultInfo.hidden = false;
      addHistory({
        name: zipName,
        date: new Date().toISOString(),
        sizeBytes: blob.size,
        pageCount: splitDoc.numPages,
        quality: "pisah",
      });

      // pratinjau daftar file sebelum download ZIP
      const ul = document.createElement("ul");
      ul.className = "modal-list";
      for (const part of parts) {
        const li = document.createElement("li");
        const nm = document.createElement("span");
        nm.textContent = U.splitName(base, part.label);
        const sz = document.createElement("span");
        sz.className = "m-size";
        sz.textContent = U.fmtSize(part.bytes.length);
        li.appendChild(nm); li.appendChild(sz);
        ul.appendChild(li);
      }
      openPreview({
        title: "Hasil pisahan PDF",
        sub: parts.length + " file · total " + U.fmtSize(total),
        bodyNode: ul,
        blob: blob,
        fileName: zipName,
        downloadLabel: '<span class="msr">download</span> Download ZIP',
      });
      toast("Berhasil! " + parts.length + " file dalam ZIP.");
    } catch (err) {
      console.error(err);
      toast("Gagal memisah: " + (err && err.message ? err.message : err));
    }
    splitBtn.innerHTML = oldLabel;
    splitBtn.disabled = false;
  });

  /* ---------- fitur: mode gelap ---------- */

  const themeToggle = $("themeToggle"), themeColorMeta = $("themeColorMeta");
  const THEME_KEY = "pdftools-theme";
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeToggle.innerHTML = '<span class="msr">' + (t === "dark" ? "light_mode" : "dark_mode") + '</span>';
    themeToggle.setAttribute("aria-label", t === "dark" ? "Ganti ke mode terang" : "Ganti ke mode gelap");
    if (themeColorMeta) themeColorMeta.content = t === "dark" ? "#0c1322" : "#e11d48";
  }
  (function initTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (t !== "dark" && t !== "light") {
      t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    applyTheme(t);
  })();
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ---------- fitur: PWA (service worker + install) ---------- */

  const installBtn = $("installBtn");
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW gagal:", e));
    });
  }
  let deferredPrompt = null;
  const hideInstall = () => { installBtn.hidden = true; deferredPrompt = null; };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)) {
      installBtn.hidden = false;
    }
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    hideInstall();
  });
  window.addEventListener("appinstalled", hideInstall);

  /* ---------- fitur: preset satu-klik ---------- */

  const presetBtns = Array.prototype.slice.call(document.querySelectorAll("[data-preset]"));
  function clearPresetActive() { presetBtns.forEach((b) => b.classList.remove("active")); }
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cfg = U.presetConfig(btn.getAttribute("data-preset"));
      if (!cfg) return;
      const r = document.querySelector('input[name="quality"][value="' + cfg.quality + '"]');
      if (r) r.checked = true;
      optimizeCheck.checked = cfg.optimize;
      qualityNote.hidden = cfg.quality === "asli";
      clearPresetActive();
      btn.classList.add("active");
      saveSettings();
      toast("Preset diterapkan: " + btn.textContent.trim());
    });
  });

  /* ---------- fitur: modal pratinjau ---------- */

  const previewModal = $("previewModal"), previewTitle = $("previewTitle"),
    previewInfo = $("previewInfo"), previewBody = $("previewBody"),
    previewDownload = $("previewDownload"), previewAgain = $("previewAgain"),
    previewClose = $("previewClose");

  function openPreview(opts) {
    closePreview();
    previewTitle.textContent = opts.title || "Pratinjau hasil";
    previewInfo.textContent = opts.sub || "";
    previewBody.innerHTML = "";
    const url = URL.createObjectURL(opts.blob);
    if (opts.bodyNode) {
      if (opts.bodyNode.tagName === "IFRAME") opts.bodyNode.src = url;
      previewBody.appendChild(opts.bodyNode);
    }
    previewModal._blobUrl = url;
    previewModal._fileName = opts.fileName || "hasil.pdf";
    previewDownload.innerHTML = opts.downloadLabel || '<span class="msr">download</span> Download';
    previewModal.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closePreview() {
    if (!previewModal.hidden) {
      previewModal.hidden = true;
      document.body.style.overflow = "";
    }
    if (previewModal._blobUrl) {
      const u = previewModal._blobUrl;
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      previewModal._blobUrl = null;
    }
    previewBody.innerHTML = "";
  }
  previewDownload.addEventListener("click", () => {
    if (!previewModal._blobUrl) return;
    const a = document.createElement("a");
    a.href = previewModal._blobUrl;
    a.download = previewModal._fileName;
    document.body.appendChild(a); a.click(); a.remove();
    toast("Mengunduh " + previewModal._fileName);
  });
  previewClose.addEventListener("click", closePreview);
  previewAgain.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (e) => { if (e.target === previewModal) closePreview(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !previewModal.hidden) closePreview();
  });

  /* ---------- fitur: riwayat lokal ---------- */

  const HIST_KEY = "pdftools-history-v1";
  const historySection = $("historySection"), historyList = $("historyList"),
    historyClearBtn = $("historyClearBtn");

  function loadHistory() {
    try {
      const r = JSON.parse(localStorage.getItem(HIST_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  function saveHistoryList(list) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function fmtHistDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) +
        " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function renderHistory() {
    const list = loadHistory();
    historySection.hidden = list.length === 0;
    historyList.innerHTML = "";
    list.forEach((h, i) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const nm = document.createElement("span");
      nm.className = "h-name"; nm.textContent = h.name; nm.title = h.name;
      const meta = document.createElement("span");
      meta.className = "h-meta";
      meta.textContent = fmtHistDate(h.date) + " · " + U.fmtSize(h.sizeBytes) +
        " · " + h.pageCount + " hal" + (h.quality ? " · " + h.quality : "");
      const del = iconBtn("close", "Hapus dari riwayat", () => {
        const l = loadHistory();
        l.splice(i, 1);
        saveHistoryList(l);
        renderHistory();
      });
      del.classList.add("h-del");
      li.appendChild(nm); li.appendChild(meta); li.appendChild(del);
      historyList.appendChild(li);
    });
  }
  function addHistory(entry) {
    saveHistoryList(U.pushHistory(loadHistory(), entry));
    renderHistory();
  }
  historyClearBtn.addEventListener("click", () => {
    if (!loadHistory().length) return;
    if (confirm("Hapus semua riwayat?")) { saveHistoryList([]); renderHistory(); }
  });
  renderHistory();

  /* ---------- fitur: pengaturan tersimpan ---------- */

  const SET_KEY = "pdftools-settings-v1";
  function saveSettings() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        quality: selectedQuality(),
        optimize: optimizeCheck.checked,
        pageNum: pageNumCheck.checked,
        pageNumPos: pageNumPos.value,
      }));
    } catch (e) {}
  }
  (function restoreSettings() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SET_KEY)); } catch (e) {}
    if (!s || typeof s !== "object") return;
    if (s.quality) {
      const r = document.querySelector('input[name="quality"][value="' + s.quality + '"]');
      if (r) { r.checked = true; qualityNote.hidden = s.quality === "asli"; }
    }
    if (typeof s.optimize === "boolean") optimizeCheck.checked = s.optimize;
    if (typeof s.pageNum === "boolean") pageNumCheck.checked = s.pageNum;
    if (s.pageNumPos === "center" || s.pageNumPos === "right") pageNumPos.value = s.pageNumPos;
  })();
  document.querySelectorAll('input[name="quality"]').forEach((el) => {
    el.addEventListener("change", () => { clearPresetActive(); saveSettings(); });
  });
  optimizeCheck.addEventListener("change", () => { clearPresetActive(); saveSettings(); });
  pageNumCheck.addEventListener("change", saveSettings);
  pageNumPos.addEventListener("change", saveSettings);

  if (!window.pdfjsLib || !window.PDFLib || !window.PdfUtil) {
    toast("Gagal memuat library (butuh internet untuk CDN).");
  }
})();
