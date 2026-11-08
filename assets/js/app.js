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

  const tabMerge = $("tabMerge"), tabSplit = $("tabSplit"), tabCompress = $("tabCompress"), tabRedact = $("tabRedact"),
    tabOrganize = $("tabOrganize"), tabWatermark = $("tabWatermark"), tabSign = $("tabSign"), tabToImage = $("tabToImage");
  const paneMerge = $("paneMerge"), paneSplit = $("paneSplit"), paneCompress = $("paneCompress"), paneRedact = $("paneRedact"),
    paneOrganize = $("paneOrganize"), paneWatermark = $("paneWatermark"), paneSign = $("paneSign"), paneToImage = $("paneToImage");
  tabMerge.addEventListener("click", () => switchTab("merge"));
  tabSplit.addEventListener("click", () => switchTab("split"));
  tabCompress.addEventListener("click", () => switchTab("compress"));
  tabRedact.addEventListener("click", () => switchTab("redact"));
  tabOrganize.addEventListener("click", () => switchTab("organize"));
  tabWatermark.addEventListener("click", () => switchTab("watermark"));
  tabSign.addEventListener("click", () => switchTab("sign"));
  tabToImage.addEventListener("click", () => switchTab("toimage"));
  function switchTab(which) {
    tabMerge.classList.toggle("active", which === "merge");
    tabSplit.classList.toggle("active", which === "split");
    tabCompress.classList.toggle("active", which === "compress");
    tabRedact.classList.toggle("active", which === "redact");
    tabOrganize.classList.toggle("active", which === "organize");
    tabWatermark.classList.toggle("active", which === "watermark");
    tabSign.classList.toggle("active", which === "sign");
    tabToImage.classList.toggle("active", which === "toimage");
    paneMerge.hidden = which !== "merge";
    paneSplit.hidden = which !== "split";
    paneCompress.hidden = which !== "compress";
    paneRedact.hidden = which !== "redact";
    paneOrganize.hidden = which !== "organize";
    paneWatermark.hidden = which !== "watermark";
    paneSign.hidden = which !== "sign";
    paneToImage.hidden = which !== "toimage";
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

  /* ---------- fitur: kompres PDF (tanpa raster halaman) ---------- */
  // Gambar di dalam PDF dikompres ulang jadi JPEG (kualitas + downscale per level).
  // Teks & grafik vektor TIDAK disentuh -> tetap bisa diseleksi.

  const COMPRESS_LEVELS = {
    ekstrem:          { q: 0.50, maxDim: 1500, label: "Ekstrem" },
    direkomendasikan: { q: 0.65, maxDim: 2200, label: "Direkomendasikan" },
    ringan:           { q: 0.80, maxDim: 3000, label: "Ringan" },
  };
  const compressFiles = []; // {id, name, bytes}
  let compressSeq = 0;

  const compressDropzone = $("compressDropzone"), compressFileInput = $("compressFileInput"),
    compressPickBtn = $("compressPickBtn"), compressWork = $("compressWork"),
    compressFileList = $("compressFileList"), compressBtn = $("compressBtn"),
    compressProgress = $("compressProgress"), compressResults = $("compressResults");

  compressPickBtn.addEventListener("click", (e) => { e.stopPropagation(); compressFileInput.click(); });
  compressDropzone.addEventListener("click", () => compressFileInput.click());
  compressFileInput.addEventListener("change", () => { addCompressFiles(compressFileInput.files); compressFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    compressDropzone.addEventListener(ev, (e) => { e.preventDefault(); compressDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    compressDropzone.addEventListener(ev, (e) => { e.preventDefault(); compressDropzone.classList.remove("dragover"); }));
  compressDropzone.addEventListener("drop", (e) => addCompressFiles(e.dataTransfer.files));

  async function addCompressFiles(list) {
    let added = 0;
    for (const file of list || []) {
      if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Hanya file PDF: " + file.name); continue; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) !== "%PDF-") {
          toast("Bukan PDF valid: " + file.name); continue;
        }
        compressFiles.push({ id: ++compressSeq, name: file.name, bytes: bytes });
        added++;
      } catch (err) { toast("Gagal baca: " + file.name); }
    }
    if (added) {
      renderCompressList();
      compressWork.hidden = false;
      compressResults.innerHTML = "";
      toast(added + " PDF ditambahkan");
    }
  }

  function renderCompressList() {
    compressFileList.innerHTML = "";
    compressFiles.forEach((f) => {
      const li = document.createElement("li");
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = f.name; nm.title = f.name;
      const sz = document.createElement("span"); sz.className = "sz"; sz.textContent = U.fmtSize(f.bytes.length);
      const rm = document.createElement("button"); rm.type = "button"; rm.className = "rm";
      rm.innerHTML = '<span class="msr">close</span>'; rm.title = "Hapus"; rm.setAttribute("aria-label", "Hapus " + f.name);
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = compressFiles.findIndex((x) => x.id === f.id);
        if (i >= 0) compressFiles.splice(i, 1);
        renderCompressList();
        if (!compressFiles.length) compressWork.hidden = true;
      });
      li.appendChild(nm); li.appendChild(sz); li.appendChild(rm);
      compressFileList.appendChild(li);
    });
  }

  function selectedCompressLevel() {
    const el = document.querySelector('input[name="compressLevel"]:checked');
    return el ? el.value : "direkomendasikan";
  }
  document.querySelectorAll('input[name="compressLevel"]').forEach((el) => {
    el.addEventListener("change", saveSettings);
  });

  // Inflate raw deflate (untuk FlateDecode).
  async function inflateDeflate(bytes) {
    const ds = new DecompressionStream("deflate");
    const s = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // JPEG bytes -> RGBA via ImageBitmap.
  async function jpegToRgba(bytes) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    bmp.close();
    return { width: c.width, height: c.height, rgba: d.data };
  }

  // RGBA -> JPEG bytes (downscale bila perlu).
  function rgbaToJpeg(rgba, w, h, tw, th, q) {
    const src = document.createElement("canvas"); src.width = w; src.height = h;
    src.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    const c = document.createElement("canvas"); c.width = tw; c.height = th;
    c.getContext("2d").drawImage(src, 0, 0, tw, th);
    const bin = atob(c.toDataURL("image/jpeg", q).split(",")[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Inti kompresi: ganti stream gambar dengan JPEG terkompres.
  async function compressPdfBytes(srcBytes, levelKey) {
    const lv = COMPRESS_LEVELS[levelKey] || COMPRESS_LEVELS.direkomendasikan;
    const doc = await PDFLib.PDFDocument.load(srcBytes);
    const pageCount = doc.getPageCount();
    const images = U.listImageXObjects(PDFLib, doc);
    const protectedRefs = new Set();
    for (const im of images) {
      if (im.sMaskRef) protectedRefs.add(im.sMaskRef.toString());
      if (im.maskRef) protectedRefs.add(im.maskRef.toString());
    }
    const N = PDFLib.PDFName;
    let replaced = 0;
    for (const im of images) {
      try {
        if (im.isMask || protectedRefs.has(im.ref.toString())) continue;
        if (im.width < 8 || im.height < 8) continue;
        const raw = im.stream.getContents();
        if (!raw || !raw.length) continue;
        let w, h, rgba;
        if (im.filters.indexOf("DCTDecode") >= 0) {
          const d = await jpegToRgba(raw);
          w = d.width; h = d.height; rgba = d.rgba;
        } else {
          const d = await U.decodeImagePixels(PDFLib, raw, im, inflateDeflate);
          w = d.width; h = d.height; rgba = d.rgba;
        }
        const scale = Math.min(1, lv.maxDim / Math.max(w, h));
        const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
        const jpg = rgbaToJpeg(rgba, w, h, tw, th, lv.q);
        if (jpg.length >= raw.length) continue; // hanya ganti bila lebih kecil
        const nd = PDFLib.PDFDict.withContext(doc.context);
        nd.set(N.of("Type"), N.of("XObject"));
        nd.set(N.of("Subtype"), N.of("Image"));
        nd.set(N.of("Width"), PDFLib.PDFNumber.of(tw));
        nd.set(N.of("Height"), PDFLib.PDFNumber.of(th));
        nd.set(N.of("ColorSpace"), N.of("DeviceRGB"));
        nd.set(N.of("BitsPerComponent"), PDFLib.PDFNumber.of(8));
        nd.set(N.of("Filter"), N.of("DCTDecode"));
        const sm = im.dict.get(N.of("SMask")); if (sm) nd.set(N.of("SMask"), sm);
        const ip = im.dict.get(N.of("Interpolate")); if (ip) nd.set(N.of("Interpolate"), ip);
        doc.context.assign(im.ref, PDFLib.PDFRawStream.of(nd, jpg));
        replaced++;
      } catch (e) { /* gambar sulit -> biarkan aslinya */ }
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return { bytes: bytes, replaced: replaced, total: images.length, pageCount: pageCount };
  }

  function downloadBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  compressBtn.addEventListener("click", async () => {
    if (!compressFiles.length) { toast("Pilih dulu file PDF-nya"); return; }
    const level = selectedCompressLevel();
    compressBtn.disabled = true;
    const oldLabel = compressBtn.innerHTML;
    compressResults.innerHTML = "";
    try {
      for (let i = 0; i < compressFiles.length; i++) {
        const f = compressFiles[i];
        compressProgress.hidden = false;
        compressProgress.textContent = "Mengompres " + (i + 1) + "/" + compressFiles.length + ": " + f.name + "…";
        let r;
        try {
          r = await compressPdfBytes(f.bytes, level);
        } catch (err) {
          console.error(err);
          compressProgress.textContent = "Gagal: " + f.name + " (PDF terkunci?)";
          continue;
        }
        const before = f.bytes.length, after = r.bytes.length;
        const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
        const outName = U.resolveFileName(f.name.replace(/\.pdf$/i, "") + "-kompres");
        addHistory({ name: outName, date: new Date().toISOString(), sizeBytes: after, pageCount: r.pageCount, quality: "kompres-" + level });

        const card = document.createElement("div"); card.className = "cresult";
        const top = document.createElement("div"); top.className = "cresult-top";
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = f.name; nm.title = f.name;
        const badge = document.createElement("span"); badge.className = "cresult-badge" + (pct <= 0 ? " zero" : "");
        badge.textContent = pct > 0 ? "hemat " + pct + "%" : (r.total ? "sudah optimal" : "tanpa gambar");
        const sizes = document.createElement("div"); sizes.className = "cresult-sizes";
        sizes.innerHTML = "<strong>" + U.fmtSize(before) + "</strong> → <strong>" + U.fmtSize(after) + "</strong>" +
          (r.total ? " · " + r.replaced + "/" + r.total + " gambar dikompres" : "");
        const acts = document.createElement("div"); acts.className = "cresult-actions";
        const bPrev = document.createElement("button"); bPrev.type = "button"; bPrev.className = "btn";
        bPrev.innerHTML = '<span class="msr">visibility</span> Pratinjau';
        const bDown = document.createElement("button"); bDown.type = "button"; bDown.className = "btn btn-primary";
        bDown.innerHTML = '<span class="msr">download</span> Download';
        const blob = new Blob([r.bytes], { type: "application/pdf" });
        bPrev.addEventListener("click", () => {
          const frame = document.createElement("iframe"); frame.title = "Pratinjau " + outName;
          openPreview({ title: "Pratinjau hasil kompres", sub: outName + " · " + U.fmtSize(after), bodyNode: frame, blob: blob, fileName: outName, downloadLabel: '<span class="msr">download</span> Download' });
        });
        bDown.addEventListener("click", () => downloadBytes(r.bytes, outName));
        acts.appendChild(bPrev); acts.appendChild(bDown);
        top.appendChild(nm); top.appendChild(badge);
        card.appendChild(top); card.appendChild(sizes); card.appendChild(acts);
        compressResults.appendChild(card);
      }
      compressProgress.textContent = "Selesai.";
      saveSettings();
    } finally {
      compressBtn.disabled = false;
      compressBtn.innerHTML = oldLabel;
    }
  });

  /* ---------- fitur: samarkan (redact) ---------- */
  // UI: thumbnail kiri, kanvas tengah + toolbar, panel kanan (info, cerdas, cari, terapkan).
  // Kotak disimpan dalam poin PDF (origin kiri-atas). Saat diterapkan, halaman
  // bertanda di-raster 200dpi + kotak dibakar hitam permanen; halaman lain disalin utuh.

  const redactState = { bytes: null, name: "", numPages: 0, boxes: {}, page: 1, tool: "draw", zoom: 1 };
  const redactDropzone = $("redactDropzone"), redactFileInput = $("redactFileInput"),
    redactPickBtn = $("redactPickBtn"), redactWork = $("redactWork"),
    redactFileName = $("redactFileName"), redactPageCount = $("redactPageCount"),
    redactThumbs = $("redactThumbs"), redactCanvas = $("redactCanvas"),
    redactCanvasWrap = $("redactCanvasWrap"), redactApplyBtn = $("redactApplyBtn"),
    redactResultInfo = $("redactResultInfo"), redactPageLabel = $("redactPageLabel"),
    redactZoomLabel = $("redactZoomLabel"), redactSearchAll = $("redactSearchAll"),
    redactSmartBtn = $("redactSmartBtn"), redactSearchAllBtn = $("redactSearchAllBtn"),
    redactMarkedWrap = $("redactMarkedWrap"), redactMarkedList = $("redactMarkedList"),
    rtoolPan = $("rtoolPan"), rtoolDraw = $("rtoolDraw"), rtoolErase = $("rtoolErase");

  const SMART_PATTERNS = [
    { re: /\b\d{16}\b/g },                                    // NIK
    { re: /\b08\d{8,12}\b/g },                                // nomor HP
    { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g }, // email
  ];

  redactPickBtn.addEventListener("click", (e) => { e.stopPropagation(); redactFileInput.click(); });
  redactDropzone.addEventListener("click", () => redactFileInput.click());
  redactFileInput.addEventListener("change", () => { loadRedactFile(redactFileInput.files[0]); redactFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    redactDropzone.addEventListener(ev, (e) => { e.preventDefault(); redactDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    redactDropzone.addEventListener(ev, (e) => { e.preventDefault(); redactDropzone.classList.remove("dragover"); }));
  redactDropzone.addEventListener("drop", (e) => loadRedactFile(e.dataTransfer.files[0]));

  async function loadRedactFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Pilih file PDF"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      Object.assign(redactState, { bytes: bytes, name: file.name, numPages: n, boxes: {}, page: 1, zoom: 1, _bg: null });
      redactFileName.textContent = file.name;
      redactPageCount.textContent = n + " halaman";
      redactWork.hidden = false;
      redactResultInfo.hidden = true;
      setTool("draw");
      renderMarkedList();
      await renderRedactThumbs(doc);
      doc.destroy();
      await showRedactPage(1);
      toast("Pilih halaman di kiri, lalu tandai area sensitif.");
    } catch (err) { console.error(err); toast("Gagal baca PDF"); }
  }

  async function renderRedactThumbs(pdfDoc) {
    redactThumbs.innerHTML = "";
    for (let n = 1; n <= redactState.numPages; n++) {
      const page = await pdfDoc.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 120 / vp0.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const t = document.createElement("button");
      t.type = "button"; t.className = "rthumb"; t.dataset.page = n;
      t.setAttribute("aria-label", "Halaman " + n);
      const img = document.createElement("img"); img.src = canvas.toDataURL("image/jpeg", 0.6); img.alt = "";
      const lab = document.createElement("span"); lab.className = "tnum"; lab.textContent = n;
      t.appendChild(img); t.appendChild(lab);
      t.addEventListener("click", () => showRedactPage(n));
      redactThumbs.appendChild(t);
    }
    markActiveThumb();
  }

  function markActiveThumb() {
    redactThumbs.querySelectorAll(".rthumb").forEach((t) => {
      const n = +t.dataset.page;
      t.classList.toggle("active", n === redactState.page);
      const c = (redactState.boxes[n] || []).length;
      let b = t.querySelector(".rbadge");
      if (c && !b) { b = document.createElement("span"); b.className = "rbadge"; t.appendChild(b); }
      if (b) { b.textContent = c; b.hidden = !c; }
    });
  }

  function rBoxes() {
    if (!redactState.boxes[redactState.page]) redactState.boxes[redactState.page] = [];
    return redactState.boxes[redactState.page];
  }

  async function showRedactPage(n) {
    redactState.page = n;
    markActiveThumb();
    const doc = await pdfjsLib.getDocument({ data: redactState.bytes.slice() }).promise;
    try {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const wrapW = Math.max(220, redactCanvasWrap.clientWidth - 32);
      const scale = (wrapW / vp1.width) * redactState.zoom;
      redactState._scale = scale;
      const vp = page.getViewport({ scale: scale });
      redactCanvas.width = Math.ceil(vp.width); redactCanvas.height = Math.ceil(vp.height);
      const ctx = redactCanvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, redactCanvas.width, redactCanvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      // cache posisi teks halaman ini (poin PDF) untuk deteksi teks kotak manual
      redactState._textBoxes = await pageTextBoxesPt(page, page.getViewport({ scale: 1 }));
      page.cleanup();
      const bg = document.createElement("canvas");
      bg.width = redactCanvas.width; bg.height = redactCanvas.height;
      bg.getContext("2d").drawImage(redactCanvas, 0, 0);
      redactState._bg = bg;
      paintRedact();
      redactPageLabel.textContent = "Hal " + n + " / " + redactState.numPages;
      redactZoomLabel.textContent = Math.round(redactState.zoom * 100) + "%";
    } finally { doc.destroy(); }
  }

  // Posisi teks dalam poin PDF (origin kiri-atas) untuk pencarian/penyamaran cerdas.
  async function pageTextBoxesPt(pdfjsPage, viewport) {
    const tc = await pdfjsPage.getTextContent();
    const mctx = pageTextBoxesPt._m || (pageTextBoxesPt._m = document.createElement("canvas").getContext("2d"));
    const scale = viewport.scale;
    const out = [];
    for (const it of tc.items) {
      const s = it.str;
      if (!s || !s.trim()) continue;
      const tx = U.mulTransform(viewport.transform, it.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || 10;
      mctx.font = fontH + "px sans-serif";
      const w = Math.max(2, mctx.measureText(s).width);
      out.push({ str: s, x: tx[4] / scale, y: (tx[5] - fontH) / scale, w: w / scale, h: (fontH * 1.3) / scale });
    }
    return out;
  }

  function paintRedact() {
    const ctx = redactCanvas.getContext("2d");
    if (redactState._bg) ctx.drawImage(redactState._bg, 0, 0);
    const s = redactState._scale || 1;
    for (const b of rBoxes()) {
      for (const p of boxParts(b)) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(p.x * s, p.y * s, p.w * s, p.h * s);
        ctx.lineWidth = 2; ctx.strokeStyle = "#e11d48";
        ctx.strokeRect(p.x * s, p.y * s, p.w * s, p.h * s);
      }
    }
    const d = redactState._drag;
    if (d) {
      const r = U.normRect(d.x1, d.y1, d.x2, d.y2);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = "#e11d48";
      ctx.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
      ctx.setLineDash([]);
    }
  }

  function rPoint(e) {
    const r = redactCanvas.getBoundingClientRect();
    const s = redactState._scale || 1;
    return {
      x: ((e.clientX - r.left) * (redactCanvas.width / r.width)) / s,
      y: ((e.clientY - r.top) * (redactCanvas.height / r.height)) / s,
    };
  }

  function rHit(p) {
    const bs = rBoxes();
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
    }
    return -1;
  }

  function setTool(t) {
    redactState.tool = t;
    rtoolPan.classList.toggle("active", t === "pan");
    rtoolDraw.classList.toggle("active", t === "draw");
    rtoolErase.classList.toggle("active", t === "erase");
    redactCanvas.style.cursor = t === "pan" ? "grab" : t === "erase" ? "pointer" : "crosshair";
    redactCanvas.style.touchAction = t === "pan" ? "pan-x pan-y" : "none";
  }
  rtoolPan.addEventListener("click", () => setTool("pan"));
  rtoolDraw.addEventListener("click", () => setTool("draw"));
  rtoolErase.addEventListener("click", () => setTool("erase"));

  redactCanvas.addEventListener("pointerdown", (e) => {
    if (redactState.tool === "erase") {
      const i = rHit(rPoint(e));
      if (i >= 0) { rBoxes().splice(i, 1); paintRedact(); markActiveThumb(); renderMarkedList(); }
      return;
    }
    if (redactState.tool === "pan") {
      redactState._pan = { x: e.clientX, y: e.clientY, sl: redactCanvasWrap.scrollLeft, st: redactCanvasWrap.scrollTop };
      redactCanvas.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    redactCanvas.setPointerCapture(e.pointerId);
    const p = rPoint(e);
    redactState._drag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  });
  redactCanvas.addEventListener("pointermove", (e) => {
    if (redactState._pan) {
      redactCanvasWrap.scrollLeft = redactState._pan.sl - (e.clientX - redactState._pan.x);
      redactCanvasWrap.scrollTop = redactState._pan.st - (e.clientY - redactState._pan.y);
      return;
    }
    if (!redactState._drag) return;
    const p = rPoint(e);
    redactState._drag.x2 = p.x; redactState._drag.y2 = p.y;
    paintRedact();
  });
  redactCanvas.addEventListener("pointerup", () => {
    if (redactState._pan) { redactState._pan = null; return; }
    const d = redactState._drag; redactState._drag = null;
    if (!d) return;
    const r = U.normRect(d.x1, d.y1, d.x2, d.y2);
    if (r.w >= 3 && r.h >= 3) {
      // Snap ke teks: pecah jadi tight-box per kata bila ada teks di bawahnya.
      const snapped = U.snapToTextBoxes(redactState._textBoxes || [], r);
      const list = rBoxes();
      const addBox = (b) => {
        const dup = list.some((x) =>
          Math.abs(x.x - b.x) < 1 && Math.abs(x.y - b.y) < 1 && Math.abs(x.w - b.w) < 1 && Math.abs(x.h - b.h) < 1);
        if (!dup) list.push(b);
      };
      if (snapped) {
        for (const s of snapped) addBox({ x: s.x, y: s.y, w: s.w, h: s.h, text: s.text, source: "manual" });
      } else {
        addBox({ x: r.x, y: r.y, w: r.w, h: r.h, text: U.textUnderRect(redactState._textBoxes || [], r), source: "manual" });
      }
      markActiveThumb(); renderMarkedList();
    }
    paintRedact();
  });
  redactCanvas.addEventListener("pointercancel", () => { redactState._drag = null; redactState._pan = null; paintRedact(); });

  $("rzoomIn").addEventListener("click", () => {
    redactState.zoom = Math.min(3, +(redactState.zoom + 0.25).toFixed(2));
    showRedactPage(redactState.page);
  });
  $("rzoomOut").addEventListener("click", () => {
    redactState.zoom = Math.max(0.5, +(redactState.zoom - 0.25).toFixed(2));
    showRedactPage(redactState.page);
  });

  function addFoundBoxes(n, matches, source) {
    if (!matches.length) return 0;
    if (!redactState.boxes[n]) redactState.boxes[n] = [];
    let added = 0;
    for (const m of matches) {
      const b = { x: m.x - 1, y: m.y - 1, w: m.w + 2, h: m.h + 2, text: m.text || "", source: source };
      if (m.parts) b.parts = m.parts;
      const dup = redactState.boxes[n].some((x) =>
        Math.abs(x.x - b.x) < 1 && Math.abs(x.y - b.y) < 1 && Math.abs(x.w - b.w) < 1 && Math.abs(x.h - b.h) < 1);
      if (!dup) { redactState.boxes[n].push(b); added++; }
    }
    return added;
  }

  // Kotak yang digambar: pakai parts (tight per kata) bila ada.
  function boxParts(b) { return b.parts && b.parts.length ? b.parts : [b]; }

  // Daftar "ditandai untuk disamarkan" di panel kanan (teks terlihat, bisa hapus satuan).
  function renderMarkedList() {
    redactMarkedList.innerHTML = "";
    const pages = Object.keys(redactState.boxes).map(Number).sort((a, b) => a - b)
      .filter((n) => (redactState.boxes[n] || []).length);
    redactMarkedWrap.hidden = !pages.length;
    for (const n of pages) {
      const h = document.createElement("div");
      h.className = "rmarked-page"; h.textContent = "Halaman " + n;
      redactMarkedList.appendChild(h);
      redactState.boxes[n].forEach((b, i) => {
        const item = document.createElement("div"); item.className = "rmarked-item";
        const ic = document.createElement("span"); ic.className = "msr";
        ic.textContent = b.source === "manual" ? "crop" : "title";
        const tx = document.createElement("span"); tx.className = "rmarked-text";
        tx.textContent = b.text || "Area manual";
        const x = document.createElement("button"); x.type = "button"; x.className = "icon-btn rmarked-x";
        x.innerHTML = '<span class="msr">close</span>'; x.setAttribute("aria-label", "Hapus tanda ini");
        x.addEventListener("click", () => {
          redactState.boxes[n].splice(i, 1);
          renderMarkedList(); paintRedact(); markActiveThumb();
        });
        item.appendChild(ic); item.appendChild(tx); item.appendChild(x);
        redactMarkedList.appendChild(item);
      });
    }
  }

  $("redactClearAll").addEventListener("click", () => {
    if (!Object.keys(redactState.boxes).some((k) => redactState.boxes[k].length)) return;
    if (confirm("Hapus semua tanda di semua halaman?")) {
      redactState.boxes = {};
      renderMarkedList(); paintRedact(); markActiveThumb();
    }
  });

  // Penyamaran cerdas: NIK, nomor HP, email di SEMUA halaman.
  redactSmartBtn.addEventListener("click", async () => {
    if (!redactState.bytes) return;
    redactSmartBtn.disabled = true;
    const old = redactSmartBtn.innerHTML;
    redactSmartBtn.innerHTML = '<span class="msr">hourglass_top</span> Memindai…';
    try {
      const doc = await pdfjsLib.getDocument({ data: redactState.bytes.slice() }).promise;
      let total = 0;
      try {
        for (let n = 1; n <= redactState.numPages; n++) {
          const page = await doc.getPage(n);
          const boxes = await pageTextBoxesPt(page, page.getViewport({ scale: 1 }));
          page.cleanup();
          for (const pat of SMART_PATTERNS) total += addFoundBoxes(n, U.findPatternMatches(boxes, pat.re), "smart");
        }
      } finally { doc.destroy(); }
      await showRedactPage(redactState.page);
      markActiveThumb(); renderMarkedList();
      toast(total ? total + " data sensitif ditandai di semua halaman" : "Tidak ditemukan pola sensitif");
    } catch (err) { console.error(err); toast("Gagal memindai"); }
    finally { redactSmartBtn.disabled = false; redactSmartBtn.innerHTML = old; }
  });

  // Cari teks di SEMUA halaman.
  async function redactSearchAllGo() {
    const q = redactSearchAll.value;
    if (!q.trim()) { toast("Ketik dulu teks yang dicari"); return; }
    if (!redactState.bytes) return;
    redactSearchAllBtn.disabled = true;
    try {
      const doc = await pdfjsLib.getDocument({ data: redactState.bytes.slice() }).promise;
      let total = 0, pages = 0;
      try {
        for (let n = 1; n <= redactState.numPages; n++) {
          const page = await doc.getPage(n);
          const boxes = await pageTextBoxesPt(page, page.getViewport({ scale: 1 }));
          page.cleanup();
          const c = addFoundBoxes(n, U.findTextMatches(boxes, q), "search");
          if (c) { total += c; pages++; }
        }
      } finally { doc.destroy(); }
      await showRedactPage(redactState.page);
      markActiveThumb(); renderMarkedList();
      toast(total ? total + " kemunculan ditandai di " + pages + " halaman" : "Tidak ketemu: " + q.trim());
    } catch (err) { console.error(err); toast("Gagal mencari"); }
    finally { redactSearchAllBtn.disabled = false; }
  }
  redactSearchAllBtn.addEventListener("click", redactSearchAllGo);
  redactSearchAll.addEventListener("keydown", (e) => { if (e.key === "Enter") redactSearchAllGo(); });

  /* ----- terapkan samarkan ----- */
  async function buildRedactedPdf() {
    const src = await PDFLib.PDFDocument.load(redactState.bytes);
    const out = await PDFLib.PDFDocument.create();
    const doc = await pdfjsLib.getDocument({ data: redactState.bytes.slice() }).promise;
    try {
      for (let n = 1; n <= redactState.numPages; n++) {
        const boxes = redactState.boxes[n] || [];
        if (!boxes.length) {
          const [cp] = await out.copyPages(src, [n - 1]);
          out.addPage(cp);
          continue;
        }
        const page = await doc.getPage(n);
        const outScale = 200 / 72;
        const vp = page.getViewport({ scale: outScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        ctx.fillStyle = "#000000";
        const pad = 2 * outScale;
        for (const b of boxes) {
          for (const p of (b.parts && b.parts.length ? b.parts : [b])) {
            ctx.fillRect(p.x * outScale - pad, p.y * outScale - pad, p.w * outScale + pad * 2, p.h * outScale + pad * 2);
          }
        }
        const jpg = await out.embedJpg(canvas.toDataURL("image/jpeg", 0.85));
        const pg = out.addPage([jpg.width, jpg.height]);
        pg.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
      }
    } finally { doc.destroy(); }
    return out.save({ useObjectStreams: true });
  }

  redactApplyBtn.addEventListener("click", async () => {
    if (!redactState.bytes) { toast("Pilih dulu file PDF-nya"); return; }
    const marked = Object.keys(redactState.boxes).filter((k) => redactState.boxes[k].length).length;
    if (!marked) { toast("Tandai dulu area yang mau disamarkan"); return; }
    if (!confirm(marked + " halaman akan disamarkan permanen. Lanjut?")) return;
    redactApplyBtn.disabled = true;
    const oldLabel = redactApplyBtn.innerHTML;
    redactApplyBtn.innerHTML = '<span class="msr">hourglass_top</span> Menyamarkan…';
    redactResultInfo.hidden = true;
    try {
      const bytes = await buildRedactedPdf();
      const before = redactState.bytes.length, after = bytes.length;
      const outName = U.resolveFileName(redactState.name.replace(/\.pdf$/i, "") + "-disamarkan");
      redactResultInfo.textContent = "Ukuran hasil: " + U.fmtSize(after) + " (sebelumnya " + U.fmtSize(before) + ")";
      redactResultInfo.hidden = false;
      addHistory({ name: outName, date: new Date().toISOString(), sizeBytes: after, pageCount: redactState.numPages, quality: "samarkan" });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const frame = document.createElement("iframe"); frame.title = "Pratinjau " + outName;
      openPreview({
        title: "Pratinjau hasil samarkan",
        sub: outName + " · " + marked + " halaman disamarkan",
        bodyNode: frame, blob: blob, fileName: outName,
        downloadLabel: '<span class="msr">download</span> Download',
      });
    } catch (err) {
      console.error(err);
      toast("Gagal menyamarkan");
    } finally {
      redactApplyBtn.disabled = false;
      redactApplyBtn.innerHTML = oldLabel;
    }
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
        compressLevel: selectedCompressLevel(),
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
    if (s.compressLevel) {
      const r = document.querySelector('input[name="compressLevel"][value="' + s.compressLevel + '"]');
      if (r) r.checked = true;
    }
  })();
  document.querySelectorAll('input[name="quality"]').forEach((el) => {
    el.addEventListener("change", () => { clearPresetActive(); saveSettings(); });
  });
  optimizeCheck.addEventListener("change", () => { clearPresetActive(); saveSettings(); });
  pageNumCheck.addEventListener("change", saveSettings);
  pageNumPos.addEventListener("change", saveSettings);

  /* ---------- fitur: atur halaman ---------- */
  // Susun ulang / putar / hapus halaman satu PDF, lalu unduh hasilnya.

  const orgState = { bytes: null, name: "", numPages: 0, pages: [] }; // pages: [{src:0-based, rot, deleted, thumbUrl}]
  const orgDropzone = $("orgDropzone"), orgFileInput = $("orgFileInput"),
    orgPickBtn = $("orgPickBtn"), orgWork = $("orgWork"),
    orgFileName = $("orgFileName"), orgPageCount = $("orgPageCount"),
    orgGrid = $("orgGrid"), orgStat = $("orgStat"),
    orgResetBtn = $("orgResetBtn"), orgApplyBtn = $("orgApplyBtn"),
    orgResultInfo = $("orgResultInfo");

  orgPickBtn.addEventListener("click", (e) => { e.stopPropagation(); orgFileInput.click(); });
  orgDropzone.addEventListener("click", () => orgFileInput.click());
  orgFileInput.addEventListener("change", () => { loadOrgFile(orgFileInput.files[0]); orgFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    orgDropzone.addEventListener(ev, (e) => { e.preventDefault(); orgDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    orgDropzone.addEventListener(ev, (e) => { e.preventDefault(); orgDropzone.classList.remove("dragover"); }));
  orgDropzone.addEventListener("drop", (e) => loadOrgFile(e.dataTransfer.files[0]));

  async function loadOrgFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Pilih file PDF"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      const pages = [];
      for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 150 / vp0.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        pages.push({ src: i - 1, rot: 0, deleted: false, thumbUrl: canvas.toDataURL("image/jpeg", 0.72) });
      }
      doc.destroy();
      Object.assign(orgState, { bytes: bytes, name: file.name, numPages: n, pages: pages });
      orgFileName.textContent = file.name;
      orgPageCount.textContent = n + " halaman";
      orgWork.hidden = false;
      orgResultInfo.hidden = true;
      renderOrgGrid();
      toast("PDF dimuat: " + n + " halaman");
    } catch (err) { console.error(err); toast("Gagal baca PDF"); }
  }

  function orgRemaining() { return orgState.pages.filter((p) => !p.deleted).length; }

  function renderOrgGrid() {
    orgGrid.innerHTML = "";
    orgStat.textContent = orgState.pages.length + " halaman · " + orgRemaining() + " tersisa";
    orgState.pages.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "page-card" + (p.deleted ? " deleted" : " included");
      card.draggable = !p.deleted;
      card.dataset.src = p.src;
      const img = document.createElement("img");
      img.className = "thumb"; img.src = p.thumbUrl; img.alt = "Halaman " + (p.src + 1); img.draggable = false;
      card.appendChild(img);
      const badge = document.createElement("div");
      badge.className = "badge-del"; badge.textContent = "dihapus";
      card.appendChild(badge);
      const rotBadge = document.createElement("div");
      rotBadge.className = "rot-badge" + (p.rot ? " on" : "");
      rotBadge.innerHTML = p.rot ? '<span class="msr">rotate_right</span>' + p.rot + "°" : "";
      card.appendChild(rotBadge);
      const movers = document.createElement("div");
      movers.className = "movers";
      if (!p.deleted) {
        movers.appendChild(iconBtn("arrow_back", "Geser kiri", () => orgMove(idx, -1)));
        movers.appendChild(iconBtn("arrow_forward", "Geser kanan", () => orgMove(idx, 1)));
        movers.appendChild(iconBtn("rotate_left", "Putar 90° ke kiri", () => { p.rot = U.normalizeRotation(p.rot - 90); renderOrgGrid(); }));
        movers.appendChild(iconBtn("rotate_right", "Putar 90° ke kanan", () => { p.rot = U.normalizeRotation(p.rot + 90); renderOrgGrid(); }));
        movers.appendChild(iconBtn("delete", "Hapus halaman ini", () => { p.deleted = true; renderOrgGrid(); }));
      } else {
        movers.appendChild(iconBtn("undo", "Kembalikan halaman ini", () => { p.deleted = false; renderOrgGrid(); }));
      }
      card.appendChild(movers);
      const meta = document.createElement("div");
      meta.className = "page-meta";
      meta.innerHTML = "Hal " + (p.src + 1) + (p.rot ? ' · <span class="msr">rotate_right</span>' + p.rot + "°" : "");
      card.appendChild(meta);
      card.addEventListener("dragstart", (e) => {
        if (p.deleted) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", "org:" + idx);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        orgGrid.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
      });
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("text/plain");
        if (raw && raw.indexOf("org:") === 0) {
          const from = +raw.slice(4);
          if (from !== idx && !orgState.pages[from].deleted) {
            const mv = orgState.pages.splice(from, 1)[0];
            orgState.pages.splice(idx, 0, mv);
            renderOrgGrid();
          }
        }
      });
      orgGrid.appendChild(card);
    });
  }

  function orgMove(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= orgState.pages.length) return;
    const tmp = orgState.pages[idx]; orgState.pages[idx] = orgState.pages[j]; orgState.pages[j] = tmp;
    renderOrgGrid();
  }

  orgResetBtn.addEventListener("click", () => {
    if (!orgState.pages.length) return;
    orgState.pages.sort((a, b) => a.src - b.src);
    orgState.pages.forEach((p) => { p.rot = 0; p.deleted = false; });
    renderOrgGrid();
    toast("Di-reset ke urutan awal");
  });

  orgApplyBtn.addEventListener("click", async () => {
    if (!orgState.bytes) { toast("Pilih dulu file PDF-nya"); return; }
    const plan = U.planFromPages(orgState.pages);
    if (!plan.length) { toast("Tidak ada halaman tersisa — kembalikan dulu halamannya"); return; }
    orgApplyBtn.disabled = true;
    const oldLabel = orgApplyBtn.innerHTML;
    orgApplyBtn.innerHTML = "⏳ Menyusun…";
    orgResultInfo.hidden = true;
    try {
      const bytes = await U.applyPagePlan(PDFLib, orgState.bytes, plan);
      const outName = U.resolveFileName(orgState.name.replace(/\.pdf$/i, "") + "-diatur");
      orgResultInfo.textContent = "Ukuran hasil: " + U.fmtSize(bytes.length) + " · " + plan.length + " halaman";
      orgResultInfo.hidden = false;
      addHistory({ name: outName, date: new Date().toISOString(), sizeBytes: bytes.length, pageCount: plan.length, quality: "atur-halaman" });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const frame = document.createElement("iframe"); frame.title = "Pratinjau " + outName;
      openPreview({
        title: "Pratinjau hasil atur halaman",
        sub: outName + " · " + plan.length + " halaman",
        bodyNode: frame, blob: blob, fileName: outName,
        downloadLabel: '<span class="msr">download</span> Download',
      });
      toast("Berhasil! " + plan.length + " halaman disusun.");
    } catch (err) { console.error(err); toast("Gagal menyusun halaman"); }
    finally { orgApplyBtn.disabled = false; orgApplyBtn.innerHTML = oldLabel; }
  });

  /* ---------- fitur: watermark ---------- */

  const WM_COLORS = {
    gray: [0.5, 0.5, 0.5],
    red: [0.85, 0.15, 0.2],
    black: [0.1, 0.1, 0.1],
    blue: [0.15, 0.35, 0.8],
  };
  const wmState = { bytes: null, name: "", numPages: 0, page1: null }; // page1: {canvas, w, h}
  const wmDropzone = $("wmDropzone"), wmFileInput = $("wmFileInput"),
    wmPickBtn = $("wmPickBtn"), wmWork = $("wmWork"),
    wmFileName = $("wmFileName"), wmPageCount = $("wmPageCount"),
    wmText = $("wmText"), wmMode = $("wmMode"), wmSize = $("wmSize"),
    wmAngle = $("wmAngle"), wmOpacity = $("wmOpacity"), wmOpacityVal = $("wmOpacityVal"),
    wmColor = $("wmColor"), wmPreviewCanvas = $("wmPreviewCanvas"),
    wmApplyBtn = $("wmApplyBtn"), wmResultInfo = $("wmResultInfo");

  wmPickBtn.addEventListener("click", (e) => { e.stopPropagation(); wmFileInput.click(); });
  wmDropzone.addEventListener("click", () => wmFileInput.click());
  wmFileInput.addEventListener("change", () => { loadWmFile(wmFileInput.files[0]); wmFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    wmDropzone.addEventListener(ev, (e) => { e.preventDefault(); wmDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    wmDropzone.addEventListener(ev, (e) => { e.preventDefault(); wmDropzone.classList.remove("dragover"); }));
  wmDropzone.addEventListener("drop", (e) => loadWmFile(e.dataTransfer.files[0]));

  async function loadWmFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Pilih file PDF"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      const page = await doc.getPage(1);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 480 / vp0.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      doc.destroy();
      Object.assign(wmState, { bytes: bytes, name: file.name, numPages: n, page1: { canvas: canvas, w: vp0.width, h: vp0.height } });
      wmFileName.textContent = file.name;
      wmPageCount.textContent = n + " halaman";
      wmWork.hidden = false;
      wmResultInfo.hidden = true;
      drawWmPreview();
      toast("PDF dimuat: " + n + " halaman");
    } catch (err) { console.error(err); toast("Gagal baca PDF"); }
  }

  function wmOpts() {
    return {
      text: wmText.value,
      mode: wmMode.value,
      size: Math.max(12, Math.min(200, +wmSize.value || 48)),
      angle: Math.max(-90, Math.min(90, +wmAngle.value || 0)),
      opacity: (+wmOpacity.value || 30) / 100,
      color: WM_COLORS[wmColor.value] || WM_COLORS.gray,
    };
  }

  // Pratinjau: gambar halaman 1 + teks watermark (skala preview : ukuran PDF asli).
  function drawWmPreview() {
    if (!wmState.page1) return;
    const o = wmOpts();
    const src = wmState.page1.canvas;
    const c = wmPreviewCanvas;
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const scale = c.width / wmState.page1.w; // px preview per poin PDF
    const col = o.color;
    ctx.fillStyle = "rgba(" + Math.round(col[0] * 255) + "," + Math.round(col[1] * 255) + "," + Math.round(col[2] * 255) + "," + o.opacity + ")";
    ctx.font = "700 " + Math.round(o.size * scale) + "px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const text = (o.text || "").trim() || "RAHASIA";
    const pts = U.watermarkPositions(wmState.page1.w, wmState.page1.h, text, o.size, o.angle, o.mode);
    for (const pt of pts) {
      ctx.save();
      ctx.translate(pt.x * scale, pt.y * scale);
      ctx.rotate((-o.angle * Math.PI) / 180); // kanvas y-bawah: balik tanda agar sama dengan PDF
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    wmOpacityVal.textContent = Math.round(o.opacity * 100) + "%";
  }

  [wmText, wmMode, wmSize, wmAngle, wmOpacity, wmColor].forEach((el) => {
    el.addEventListener("input", drawWmPreview);
    el.addEventListener("change", drawWmPreview);
  });

  wmApplyBtn.addEventListener("click", async () => {
    if (!wmState.bytes) { toast("Pilih dulu file PDF-nya"); return; }
    wmApplyBtn.disabled = true;
    const oldLabel = wmApplyBtn.innerHTML;
    wmApplyBtn.innerHTML = '<span class="msr">hourglass_top</span> Menambah watermark…';
    wmResultInfo.hidden = true;
    try {
      const bytes = await U.applyWatermark(PDFLib, wmState.bytes, wmOpts());
      const outName = U.resolveFileName(wmState.name.replace(/\.pdf$/i, "") + "-watermark");
      wmResultInfo.textContent = "Ukuran hasil: " + U.fmtSize(bytes.length) + " · " + wmState.numPages + " halaman";
      wmResultInfo.hidden = false;
      addHistory({ name: outName, date: new Date().toISOString(), sizeBytes: bytes.length, pageCount: wmState.numPages, quality: "watermark" });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const frame = document.createElement("iframe"); frame.title = "Pratinjau " + outName;
      openPreview({
        title: "Pratinjau hasil watermark",
        sub: outName + " · " + wmState.numPages + " halaman",
        bodyNode: frame, blob: blob, fileName: outName,
        downloadLabel: '<span class="msr">download</span> Download',
      });
      toast("Watermark ditambahkan!");
    } catch (err) { console.error(err); toast("Gagal menambah watermark"); }
    finally { wmApplyBtn.disabled = false; wmApplyBtn.innerHTML = oldLabel; }
  });

  /* ---------- fitur: tanda tangan ---------- */

  const signState = { bytes: null, name: "", numPages: 0, page: 1 };
  const signPad = $("signPad"), signClearBtn = $("signClearBtn"),
    signUploadBtn = $("signUploadBtn"), signUploadInput = $("signUploadInput"),
    signDropzone = $("signDropzone"), signFileInput = $("signFileInput"),
    signPickBtn = $("signPickBtn"), signWork = $("signWork"),
    signFileName = $("signFileName"), signPageCount = $("signPageCount"),
    signPage = $("signPage"), signPageTotal = $("signPageTotal"),
    signPrevPage = $("signPrevPage"), signNextPage = $("signNextPage"),
    signPos = $("signPos"), signWidth = $("signWidth"), signWidthVal = $("signWidthVal"),
    signPreviewCanvas = $("signPreviewCanvas"),
    signApplyBtn = $("signApplyBtn"), signResultInfo = $("signResultInfo");

  // --- kanvas gambar tanda tangan ---
  const signCtx = signPad.getContext("2d");
  signCtx.lineWidth = 2.5; signCtx.lineCap = "round"; signCtx.lineJoin = "round"; signCtx.strokeStyle = "#111827";
  let signDrawing = false, signLast = null;
  function signPadPos(e) {
    const r = signPad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (signPad.width / r.width), y: (e.clientY - r.top) * (signPad.height / r.height) };
  }
  signPad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    signPad.setPointerCapture(e.pointerId);
    signDrawing = true; signLast = signPadPos(e);
  });
  signPad.addEventListener("pointermove", (e) => {
    if (!signDrawing || !signLast) return;
    const p = signPadPos(e);
    signCtx.beginPath(); signCtx.moveTo(signLast.x, signLast.y); signCtx.lineTo(p.x, p.y); signCtx.stroke();
    signLast = p;
  });
  function signEndDraw() {
    if (signDrawing) { signDrawing = false; signLast = null; drawSignPreview(); }
  }
  signPad.addEventListener("pointerup", signEndDraw);
  signPad.addEventListener("pointercancel", signEndDraw);

  signClearBtn.addEventListener("click", () => {
    signCtx.clearRect(0, 0, signPad.width, signPad.height);
    drawSignPreview();
  });

  signUploadBtn.addEventListener("click", () => signUploadInput.click());
  signUploadInput.addEventListener("change", async () => {
    const f = signUploadInput.files[0];
    signUploadInput.value = "";
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = await loadImageFromUrl(url);
      URL.revokeObjectURL(url);
      signCtx.clearRect(0, 0, signPad.width, signPad.height);
      const s = Math.min(signPad.width / img.naturalWidth, signPad.height / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      signCtx.drawImage(img, (signPad.width - w) / 2, (signPad.height - h) / 2, w, h);
      drawSignPreview();
      toast("Gambar tanda tangan dimuat");
    } catch (err) { toast("Gagal baca gambar"); }
  });

  // Potong kanvas ke area bertinta (biar posisi di PDF pas, tanpa margin kosong).
  function signTrimmedCanvas() {
    const w = signPad.width, h = signPad.height;
    const data = signCtx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null; // kanvas kosong
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(signPad, x0, y0, cw, ch, 0, 0, cw, ch);
    return { canvas: c, w: cw, h: ch };
  }

  function signPngBytes() {
    const t = signTrimmedCanvas();
    if (!t) return null;
    const bin = atob(t.canvas.toDataURL("image/png").split(",")[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Pratinjau: halaman yang dipilih + tanda tangan di posisi yang diatur.
  async function drawSignPreview() {
    signWidthVal.textContent = signWidth.value + " pt";
    if (!signState.bytes) return;
    const doc = await pdfjsLib.getDocument({ data: signState.bytes.slice() }).promise;
    try {
      const n = Math.max(1, Math.min(signState.numPages, +signPage.value || 1));
      const page = await doc.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 480 / vp0.width });
      const c = signPreviewCanvas;
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const t = signTrimmedCanvas();
      if (t) {
        const r = U.signatureRect(vp0.width, vp0.height, t.w, t.h, signPos.value, +signWidth.value || 150, 36);
        const scale = c.width / vp0.width;
        // koordinat PDF (y dari bawah) -> kanvas (y dari atas)
        ctx.drawImage(t.canvas, r.x * scale, c.height - (r.y + r.h) * scale, r.w * scale, r.h * scale);
      }
    } finally { doc.destroy(); }
  }

  signPickBtn.addEventListener("click", (e) => { e.stopPropagation(); signFileInput.click(); });
  signDropzone.addEventListener("click", () => signFileInput.click());
  signFileInput.addEventListener("change", () => { loadSignFile(signFileInput.files[0]); signFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    signDropzone.addEventListener(ev, (e) => { e.preventDefault(); signDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    signDropzone.addEventListener(ev, (e) => { e.preventDefault(); signDropzone.classList.remove("dragover"); }));
  signDropzone.addEventListener("drop", (e) => loadSignFile(e.dataTransfer.files[0]));

  async function loadSignFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Pilih file PDF"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      doc.destroy();
      Object.assign(signState, { bytes: bytes, name: file.name, numPages: n, page: 1 });
      signFileName.textContent = file.name;
      signPageCount.textContent = n + " halaman";
      signPageTotal.textContent = n;
      signPage.max = n; signPage.value = 1;
      signWork.hidden = false;
      signResultInfo.hidden = true;
      drawSignPreview();
      toast("PDF dimuat: " + n + " halaman");
    } catch (err) { console.error(err); toast("Gagal baca PDF"); }
  }

  signPage.addEventListener("change", () => {
    signPage.value = Math.max(1, Math.min(signState.numPages, +signPage.value || 1));
    drawSignPreview();
  });
  signPrevPage.addEventListener("click", () => { signPage.value = Math.max(1, (+signPage.value || 1) - 1); drawSignPreview(); });
  signNextPage.addEventListener("click", () => { signPage.value = Math.min(signState.numPages, (+signPage.value || 1) + 1); drawSignPreview(); });
  signPos.addEventListener("change", drawSignPreview);
  signWidth.addEventListener("input", drawSignPreview);

  signApplyBtn.addEventListener("click", async () => {
    if (!signState.bytes) { toast("Pilih dulu file PDF-nya"); return; }
    const png = signPngBytes();
    if (!png) { toast("Gambar dulu tanda tanganmu di kanvas atas"); return; }
    signApplyBtn.disabled = true;
    const oldLabel = signApplyBtn.innerHTML;
    signApplyBtn.innerHTML = '<span class="msr">hourglass_top</span> Menempel…';
    signResultInfo.hidden = true;
    try {
      const bytes = await U.applySignature(PDFLib, signState.bytes, png, {
        page: +signPage.value || 1, pos: signPos.value, width: +signWidth.value || 150,
      });
      const outName = U.resolveFileName(signState.name.replace(/\.pdf$/i, "") + "-ditandatangani");
      signResultInfo.textContent = "Ukuran hasil: " + U.fmtSize(bytes.length) + " · halaman " + (+signPage.value || 1);
      signResultInfo.hidden = false;
      addHistory({ name: outName, date: new Date().toISOString(), sizeBytes: bytes.length, pageCount: signState.numPages, quality: "tanda-tangan" });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const frame = document.createElement("iframe"); frame.title = "Pratinjau " + outName;
      openPreview({
        title: "Pratinjau hasil tanda tangan",
        sub: outName + " · halaman " + (+signPage.value || 1),
        bodyNode: frame, blob: blob, fileName: outName,
        downloadLabel: '<span class="msr">download</span> Download',
      });
      toast("Tanda tangan ditempel!");
    } catch (err) { console.error(err); toast("Gagal menempel tanda tangan"); }
    finally { signApplyBtn.disabled = false; signApplyBtn.innerHTML = oldLabel; }
  });

  /* ---------- fitur: PDF ke gambar ---------- */

  const imgState = { bytes: null, name: "", numPages: 0 };
  const imgDropzone = $("imgDropzone"), imgFileInput = $("imgFileInput"),
    imgPickBtn = $("imgPickBtn"), imgWork = $("imgWork"),
    imgFileName = $("imgFileName"), imgPageCount = $("imgPageCount"),
    imgDpi = $("imgDpi"), imgRange = $("imgRange"),
    imgApplyBtn = $("imgApplyBtn"), imgProgress = $("imgProgress"),
    imgResults = $("imgResults");

  imgPickBtn.addEventListener("click", (e) => { e.stopPropagation(); imgFileInput.click(); });
  imgDropzone.addEventListener("click", () => imgFileInput.click());
  imgFileInput.addEventListener("change", () => { loadImgFile(imgFileInput.files[0]); imgFileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    imgDropzone.addEventListener(ev, (e) => { e.preventDefault(); imgDropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    imgDropzone.addEventListener(ev, (e) => { e.preventDefault(); imgDropzone.classList.remove("dragover"); }));
  imgDropzone.addEventListener("drop", (e) => loadImgFile(e.dataTransfer.files[0]));

  async function loadImgFile(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { toast("Pilih file PDF"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const n = doc.numPages;
      doc.destroy();
      Object.assign(imgState, { bytes: bytes, name: file.name, numPages: n });
      imgFileName.textContent = file.name;
      imgPageCount.textContent = n + " halaman";
      imgWork.hidden = false;
      imgProgress.hidden = true;
      imgResults.innerHTML = "";
      toast("PDF dimuat: " + n + " halaman");
    } catch (err) { console.error(err); toast("Gagal baca PDF"); }
  }

  function imgFormat() {
    const el = document.querySelector('input[name="imgFormat"]:checked');
    return el ? el.value : "jpg";
  }

  imgApplyBtn.addEventListener("click", async () => {
    if (!imgState.bytes) { toast("Pilih dulu file PDF-nya"); return; }
    if (!window.JSZip) { toast("Gagal memuat JSZip (butuh internet untuk CDN)."); return; }
    let pages;
    try {
      const raw = imgRange.value.trim();
      if (!raw) pages = Array.from({ length: imgState.numPages }, (_, i) => i + 1);
      else {
        pages = [];
        for (const [s, e] of U.parseRanges(raw, imgState.numPages)) {
          for (let n = s; n <= e; n++) pages.push(n);
        }
        pages = Array.from(new Set(pages)).sort((a, b) => a - b);
      }
    } catch (err) { toast(err.message); return; }
    if (!pages.length) { toast("Tidak ada halaman dipilih"); return; }
    const fmt = imgFormat();
    const dpi = +imgDpi.value || 200;
    const scale = dpi / 72;
    imgApplyBtn.disabled = true;
    const oldLabel = imgApplyBtn.innerHTML;
    imgResults.innerHTML = "";
    imgProgress.hidden = false;
    try {
      const doc = await pdfjsLib.getDocument({ data: imgState.bytes.slice() }).promise;
      const base = imgState.name.replace(/\.pdf$/i, "") || "dokumen";
      const files = [];
      try {
        for (let i = 0; i < pages.length; i++) {
          const n = pages[i];
          imgProgress.textContent = "Merender halaman " + (i + 1) + "/" + pages.length + "…";
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          page.cleanup();
          const name = U.imageFileName(base, n, imgState.numPages, fmt);
          const blob = await new Promise((res) => canvas.toBlob(res, fmt === "png" ? "image/png" : "image/jpeg", 0.92));
          files.push({ name: name, blob: blob, size: blob.size, url: URL.createObjectURL(blob) });
        }
      } finally { doc.destroy(); }
      imgProgress.textContent = "Selesai: " + files.length + " gambar dibuat.";
      addHistory({ name: files.length > 1 ? base + "-gambar.zip" : files[0].name, date: new Date().toISOString(), sizeBytes: files.reduce((s, f) => s + f.size, 0), pageCount: files.length, quality: "pdf-ke-gambar" });
      for (const f of files) {
        const card = document.createElement("div"); card.className = "cresult";
        const top = document.createElement("div"); top.className = "cresult-top";
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = f.name; nm.title = f.name;
        const sz = document.createElement("span"); sz.className = "cresult-badge"; sz.textContent = U.fmtSize(f.size);
        top.appendChild(nm); top.appendChild(sz);
        const thumb = document.createElement("img");
        thumb.src = f.url; thumb.alt = f.name; thumb.className = "img-thumb";
        const acts = document.createElement("div"); acts.className = "cresult-actions";
        const bDown = document.createElement("button"); bDown.type = "button"; bDown.className = "btn btn-primary";
        bDown.innerHTML = '<span class="msr">download</span> Download';
        bDown.addEventListener("click", () => {
          const a = document.createElement("a");
          a.href = f.url; a.download = f.name;
          document.body.appendChild(a); a.click(); a.remove();
        });
        acts.appendChild(bDown);
        card.appendChild(top); card.appendChild(thumb); card.appendChild(acts);
        imgResults.appendChild(card);
      }
      if (files.length > 1) {
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f.blob);
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipName = U.resolveFileName(base + "-gambar").replace(/\.pdf$/i, "") + ".zip";
        const ul = document.createElement("ul");
        ul.className = "modal-list";
        for (const f of files) {
          const li = document.createElement("li");
          const nm = document.createElement("span"); nm.textContent = f.name;
          const sz = document.createElement("span"); sz.className = "m-size"; sz.textContent = U.fmtSize(f.size);
          li.appendChild(nm); li.appendChild(sz);
          ul.appendChild(li);
        }
        openPreview({
          title: "Hasil PDF ke gambar",
          sub: files.length + " gambar · total " + U.fmtSize(zipBlob.size),
          bodyNode: ul, blob: zipBlob, fileName: zipName,
          downloadLabel: '<span class="msr">download</span> Download ZIP',
        });
      }
      toast("Berhasil! " + files.length + " gambar dibuat.");
    } catch (err) { console.error(err); toast("Gagal mengubah ke gambar"); }
    finally { imgApplyBtn.disabled = false; imgApplyBtn.innerHTML = oldLabel; }
  });

  if (!window.pdfjsLib || !window.PDFLib || !window.PdfUtil) {
    toast("Gagal memuat library (butuh internet untuk CDN).");
  }
})();
