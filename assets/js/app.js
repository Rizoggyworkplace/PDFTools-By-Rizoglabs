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
  const fileList = $("fileList"), toolbar = $("toolbar"), actionBar = $("actionBar");
  const emptyHint = $("emptyHint"), statText = $("statText"), mergeBtn = $("mergeBtn");
  const mergeCount = $("mergeCount"), toastEl = $("toast");
  const fileNameInput = $("fileNameInput"), optimizeCheck = $("optimizeCheck");
  const resultInfo = $("resultInfo");

  let pages = [];       // {uid,fileUid,fileName,kind:'pdf'|'img',pageNum,pdfBytes,imgDataUrl,thumbUrl,included}
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
    b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
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
    files.push({ uid: fileUid, name: file.name, expanded: false });
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
      movers.appendChild(iconBtn("▲", "Pindah ke atas", () => moveFile(f.uid, -1)));
      movers.appendChild(iconBtn("▼", "Pindah ke bawah", () => moveFile(f.uid, 1)));

      const exp = document.createElement("span");
      exp.className = "expand-ind"; exp.textContent = f.expanded ? "▾" : "▸";

      const rm = iconBtn("✕", "Hapus file ini", () => {
        pages = pages.filter((p) => p.fileUid !== f.uid);
        files = files.filter((x) => x.uid !== f.uid);
        render();
        toast("File dihapus: " + f.name);
      });
      rm.classList.add("file-remove");

      head.appendChild(grip); head.appendChild(info); head.appendChild(movers);
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

  /* ---------- nama file hasil & format ukuran ---------- */

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

    const check = document.createElement("div");
    check.className = "check"; check.textContent = "✓";
    card.appendChild(check);

    const movers = document.createElement("div");
    movers.className = "movers";
    const bl = iconBtn("◀", "Geser kiri", () => movePageWithinFile(p.uid, -1));
    const br = iconBtn("▶", "Geser kanan", () => movePageWithinFile(p.uid, 1));
    movers.appendChild(bl); movers.appendChild(br);
    card.appendChild(movers);

    const meta = document.createElement("div");
    meta.className = "page-meta";
    meta.textContent = p.kind === "pdf" ? "Hal " + p.pageNum : "gambar";
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

  /* ---------- merge & download ---------- */

  mergeBtn.addEventListener("click", async () => {
    const chosen = collectChosen();
    if (!chosen.length) { toast("Pilih dulu halamannya"); return; }
    mergeBtn.disabled = true;
    const oldLabel = mergeBtn.innerHTML;
    mergeBtn.innerHTML = "⏳ Menggabung…";
    resultInfo.hidden = true;
    try {
      const fileName = resolveFileName(fileNameInput.value);
      const optimize = optimizeCheck.checked;
      const { bytes, plainBytes } = await buildPdf(chosen, optimize);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      let info = "Ukuran hasil: " + fmtSize(bytes.length);
      if (plainBytes && plainBytes.length > bytes.length) {
        const hemat = Math.round((1 - bytes.length / plainBytes.length) * 100);
        info += " (tanpa optimasi: " + fmtSize(plainBytes.length) + " · hemat " + hemat + "%)";
      }
      resultInfo.textContent = info;
      resultInfo.hidden = false;
      toast("Berhasil! " + chosen.length + " halaman digabung.");
    } catch (err) {
      console.error(err);
      toast("Gagal menggabung: " + (err && err.message ? err.message : err));
    }
    mergeBtn.innerHTML = oldLabel;
    mergeBtn.disabled = false;
  });

  // optimize=true: simpan dengan object streams -- lossless & struktural
  // (tidak recompress/downscale gambar, tidak mengubah teks).
  // Mengembalikan bytes final + versi tanpa optimasi untuk perbandingan ukuran.
  async function buildPdf(chosen, optimize) {
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
    if (optimize) {
      const plainBytes = await out.save({ useObjectStreams: false });
      const bytes = await out.save({ useObjectStreams: true });
      return { bytes, plainBytes };
    }
    return { bytes: await out.save({ useObjectStreams: false }), plainBytes: null };
  }

  
  if (!window.pdfjsLib || !window.PDFLib) {
    toast("Gagal memuat library (butuh internet untuk CDN).");
  }
})();
