import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, query, where, limit, getDocs, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHC1apydBUTxsz3ZhJUhw4ukNIb9WD90E",
  authDomain: "notepad-d9f0b.firebaseapp.com",
  projectId: "notepad-d9f0b",
  storageBucket: "notepad-d9f0b.firebasestorage.app",
  messagingSenderId: "1081281593555",
  appId: "1:1081281593555:web:ab931db0e2282f8e325426"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Ikon svg kecil pengganti emoji (dipakai lewat innerHTML di beberapa tempat)
const shareIconSvg = `<svg class="icon-sm" viewBox="0 0 24 24" style="vertical-align:-2px; margin-right:4px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>`;
const linkIconSvgSmall = `<svg class="icon-sm" viewBox="0 0 24 24" style="vertical-align:-2px; margin-right:3px;"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>`;
const tagIconSvgSmall = `<svg class="icon-sm" viewBox="0 0 24 24" style="vertical-align:-2px; margin-right:3px;"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.41 12.4A2 2 0 0 1 2 11V4a2 2 0 0 1 2-2h7a2 2 0 0 1 1.41.59l8.18 8.18a2 2 0 0 1 0 2.83Z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>`;

// Upload foto lewat serverless function /api/upload (Vercel), yang
// meneruskan file ke Cloudflare R2. Lihat api/upload.js.
async function uploadToCloudflare(file) {
  const dataBase64 = await fileToBase64(file);
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      dataBase64
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Upload ke Cloudflare gagal");
  }
  return data.url;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Hapus file dari Cloudflare R2 lewat /api/delete. Best-effort: dipanggil
// tanpa menghalangi alur utama (simpan/hapus post di Firestore tetap jalan
// walau ini gagal) -- tapi tetap diusahakan supaya file R2 tidak menumpuk
// jadi sampah setiap kali foto/post dihapus dari admin.
async function deleteFromCloudflare(urls) {
  const list = (urls || []).filter(Boolean);
  if (list.length === 0) return;
  try {
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: list })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("Gagal menghapus foto lama dari Cloudflare R2:", data.error || res.status);
    }
  } catch (err) {
    console.error("Gagal menghapus foto lama dari Cloudflare R2:", err);
  }
}

// Kode pendek 6 karakter (huruf besar & kecil saja) untuk link domain/p/KODE
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function generateCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}
async function generateUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const qCode = query(collection(db, "posts"), where("code", "==", code), limit(1));
    const snap = await getDocs(qCode);
    if (snap.empty) return code;
  }
  throw new Error("Gagal membuat kode unik, coba lagi.");
}

const loginCard = document.getElementById("loginCard");
const formCard = document.getElementById("formCard");
const listCard = document.getElementById("listCard");
const contactCard = document.getElementById("contactCard");
const loginMsg = document.getElementById("loginMsg");
const formMsg = document.getElementById("formMsg");
const formTitle = document.getElementById("formTitleText");
const submitBtn = document.getElementById("submitBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const existingPreview = document.getElementById("existingPreview");

let selectedFiles = [];
let editingId = null;
let editingExistingPhotos = [];
let editingCode = null;
let removedExistingPhotos = []; // foto lama yang dibuang selama sesi edit ini, baru benar-benar dihapus dari R2 saat Simpan Perubahan berhasil

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginCard.style.display = "none";
    formCard.style.display = "block";
    listCard.style.display = "block";
    contactCard.style.display = "block";
    loadContactSettings();
    listenPosts();
  } else {
    loginCard.style.display = "block";
    formCard.style.display = "none";
    listCard.style.display = "none";
    contactCard.style.display = "none";
  }
});

document.getElementById("loginBtn").onclick = async () => {
  loginMsg.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginMsg.textContent = "Login gagal: email/password salah.";
  }
};

document.getElementById("logoutBtn").onclick = () => signOut(auth);

/* ================== ENGINE CROPPING FOTO FLEKSIBEL ==================
   Geser (drag/pointer) untuk atur posisi, slider untuk zoom, dan chip
   rasio (Bebas/1:1/4:5/3:4/16:9/9:16). Output di-render ke <canvas> lalu
   dikompres jadi JPEG sebelum diupload ke Cloudflare R2 lewat /api/upload,
   supaya ukuran file ringan & framing-nya konsisten dengan tampilan di
   index (post-photos: object-fit cover). */
const cropOverlay = document.getElementById("cropModalOverlay");
const cropStage = document.getElementById("cropStage");
const cropImgEl = document.getElementById("cropImg");
const cropZoomRange = document.getElementById("cropZoomRange");
const cropAspectBar = document.getElementById("cropAspectBar");
const cropCloseBtn = document.getElementById("cropCloseBtn");
const cropConfirmBtn = document.getElementById("cropConfirmBtn");
const cropSwapBtn = document.getElementById("cropSwapBtn");
const cropSwapInput = document.getElementById("cropSwapInput");

const CROP_STAGE_MAX_W = 360;

let cropResolve = null;
let cropObjectUrl = null;
let cropNaturalW = 0, cropNaturalH = 0;
let cropRatio = 0; // 0 = Bebas (ikut rasio asli foto)
let cropBaseScale = 1;
let cropScale = 1;
let cropOffsetX = 0, cropOffsetY = 0;
let cropDragging = false;
let cropDragStartX = 0, cropDragStartY = 0;
let cropOffsetStartX = 0, cropOffsetStartY = 0;
const cropActivePointers = new Map();
let cropPinchStartDist = 0;
let cropPinchStartScale = 1;

function openCropperForFile(file) {
  return new Promise((resolve) => {
    cropResolve = resolve;
    loadFileIntoCropper(file);
  });
}

function loadFileIntoCropper(file) {
  if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
  cropObjectUrl = URL.createObjectURL(file);
  cropImgEl.src = cropObjectUrl;
  cropImgEl.onload = () => {
    cropNaturalW = cropImgEl.naturalWidth;
    cropNaturalH = cropImgEl.naturalHeight;
    cropAspectBar.querySelectorAll(".crop-aspect-chip").forEach((c) => c.classList.remove("active"));
    cropAspectBar.querySelector('[data-ratio="0"]').classList.add("active");
    cropRatio = 0;
    // Modal harus sudah tampil (display:flex) DULU sebelum menghitung ukuran
    // stage — kalau dihitung sewaktu modal masih display:none, clientWidth/
    // Height selalu 0 dan hasil crop bisa jadi kosong.
    cropOverlay.classList.add("open");
    setupCropStageSize();
    resetCropTransform();
  };
}

function setupCropStageSize() {
  const stageW = Math.min(CROP_STAGE_MAX_W, window.innerWidth - 64);
  const ratio = cropRatio > 0 ? cropRatio : (cropNaturalW / cropNaturalH);
  const stageH = stageW / ratio;
  cropStage.style.width = stageW + "px";
  cropStage.style.height = stageH + "px";
}

function resetCropTransform() {
  let stageW = cropStage.clientWidth;
  let stageH = cropStage.clientHeight;
  if (!stageW || !stageH) {
    stageW = CROP_STAGE_MAX_W;
    stageH = cropRatio > 0 ? stageW / cropRatio : stageW * (cropNaturalH / cropNaturalW);
  }
  cropBaseScale = Math.max(stageW / cropNaturalW, stageH / cropNaturalH);
  cropScale = cropBaseScale;
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropZoomRange.value = 100;
  applyCropTransform();
}

function clampCropOffsets() {
  const stageW = cropStage.clientWidth;
  const stageH = cropStage.clientHeight;
  const dispW = cropNaturalW * cropScale;
  const dispH = cropNaturalH * cropScale;
  const maxX = Math.max(0, (dispW - stageW) / 2);
  const maxY = Math.max(0, (dispH - stageH) / 2);
  cropOffsetX = Math.min(maxX, Math.max(-maxX, cropOffsetX));
  cropOffsetY = Math.min(maxY, Math.max(-maxY, cropOffsetY));
}

function applyCropTransform() {
  clampCropOffsets();
  const stageW = cropStage.clientWidth;
  const stageH = cropStage.clientHeight;
  const dispW = cropNaturalW * cropScale;
  const dispH = cropNaturalH * cropScale;
  cropImgEl.style.width = dispW + "px";
  cropImgEl.style.height = dispH + "px";
  cropImgEl.style.left = ((stageW - dispW) / 2 + cropOffsetX) + "px";
  cropImgEl.style.top = ((stageH - dispH) / 2 + cropOffsetY) + "px";
}

cropAspectBar.querySelectorAll(".crop-aspect-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    cropAspectBar.querySelectorAll(".crop-aspect-chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    cropRatio = Number(btn.dataset.ratio);
    setupCropStageSize();
    resetCropTransform();
  });
});

cropZoomRange.addEventListener("input", () => {
  const pct = Number(cropZoomRange.value) / 100;
  cropScale = cropBaseScale * pct;
  applyCropTransform();
});

function cropPointerDown(e) {
  cropActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cropStage.setPointerCapture(e.pointerId);
  if (cropActivePointers.size === 1) {
    cropDragging = true;
    cropStage.classList.add("dragging");
    cropDragStartX = e.clientX;
    cropDragStartY = e.clientY;
    cropOffsetStartX = cropOffsetX;
    cropOffsetStartY = cropOffsetY;
  } else if (cropActivePointers.size === 2) {
    cropDragging = false;
    const pts = Array.from(cropActivePointers.values());
    cropPinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    cropPinchStartScale = cropScale;
  }
}
function cropPointerMove(e) {
  if (!cropActivePointers.has(e.pointerId)) return;
  cropActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (cropActivePointers.size === 2) {
    const pts = Array.from(cropActivePointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (cropPinchStartDist > 0) {
      const minScale = cropBaseScale;
      const maxScale = cropBaseScale * 3;
      cropScale = Math.min(maxScale, Math.max(minScale, cropPinchStartScale * (dist / cropPinchStartDist)));
      cropZoomRange.value = Math.round((cropScale / cropBaseScale) * 100);
      applyCropTransform();
    }
  } else if (cropDragging) {
    cropOffsetX = cropOffsetStartX + (e.clientX - cropDragStartX);
    cropOffsetY = cropOffsetStartY + (e.clientY - cropDragStartY);
    applyCropTransform();
  }
}
function cropPointerUp(e) {
  cropActivePointers.delete(e.pointerId);
  if (cropActivePointers.size < 2) cropPinchStartDist = 0;
  if (cropActivePointers.size === 0) {
    cropDragging = false;
    cropStage.classList.remove("dragging");
  }
}
cropStage.addEventListener("pointerdown", cropPointerDown);
cropStage.addEventListener("pointermove", cropPointerMove);
cropStage.addEventListener("pointerup", cropPointerUp);
cropStage.addEventListener("pointercancel", cropPointerUp);
cropStage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.08 : 0.93;
  const minScale = cropBaseScale;
  const maxScale = cropBaseScale * 3;
  cropScale = Math.min(maxScale, Math.max(minScale, cropScale * delta));
  cropZoomRange.value = Math.round((cropScale / cropBaseScale) * 100);
  applyCropTransform();
}, { passive: false });

function closeCropModal(result) {
  cropOverlay.classList.remove("open");
  if (cropObjectUrl) { URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = null; }
  const resolve = cropResolve;
  cropResolve = null;
  if (resolve) resolve(result);
}

cropCloseBtn.onclick = () => closeCropModal(null);

cropSwapBtn.onclick = () => cropSwapInput.click();
cropSwapInput.addEventListener("change", () => {
  const file = cropSwapInput.files[0];
  cropSwapInput.value = "";
  if (file) loadFileIntoCropper(file);
});

cropConfirmBtn.onclick = () => {
  const stageW = cropStage.clientWidth;
  const stageH = cropStage.clientHeight;

  if (!stageW || !stageH || !cropScale || !cropNaturalW || !cropNaturalH) {
    alert("Foto belum siap di-crop, coba tunggu sebentar lalu ulangi.");
    return;
  }

  const outW = 1080;
  const outH = Math.round(outW * (stageH / stageW));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");

  const renderScale = outW / stageW;
  const dispW = cropNaturalW * cropScale * renderScale;
  const dispH = cropNaturalH * cropScale * renderScale;
  const centerX = outW / 2 + cropOffsetX * renderScale;
  const centerY = outH / 2 + cropOffsetY * renderScale;

  ctx.drawImage(cropImgEl, centerX - dispW / 2, centerY - dispH / 2, dispW, dispH);

  canvas.toBlob((blob) => {
    closeCropModal(blob);
  }, "image/jpeg", 0.9);
};

function makeCroppedFile(blob, originalName) {
  const base = (originalName || "foto").replace(/\.[^./\\]+$/, "");
  return new File([blob], `${base}-crop.jpg`, { type: "image/jpeg" });
}

document.getElementById("photos").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = ""; // biar file yang sama bisa dipilih ulang lain kali
  for (const file of files) {
    const cropped = await openCropperForFile(file);
    if (cropped) {
      selectedFiles.push(makeCroppedFile(cropped, file.name));
      renderNewPreview();
    }
  }
});

function renderNewPreview() {
  const preview = document.getElementById("preview");
  preview.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "preview-item";
    const objUrl = URL.createObjectURL(file);
    wrap.innerHTML = `
      <img src="${objUrl}" title="Foto baru">
      <button type="button" class="editCropBtn" title="Atur ulang crop"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
      <button type="button" class="removeBtn" title="Hapus foto"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    `;
    wrap.querySelector(".removeBtn").onclick = () => {
      selectedFiles.splice(idx, 1);
      renderNewPreview();
    };
    wrap.querySelector(".editCropBtn").onclick = async () => {
      const cropped = await openCropperForFile(file);
      if (cropped) {
        selectedFiles[idx] = makeCroppedFile(cropped, file.name);
        renderNewPreview();
      }
    };
    preview.appendChild(wrap);
  });
}

const linksContainer = document.getElementById("linksContainer");

function addLinkRow(label = "", url = "") {
  const row = document.createElement("div");
  row.className = "link-row";
  row.innerHTML = `
    <input type="text" placeholder="Nama (mis. Kuis)" value="${escapeAttr(label)}">
    <input type="url" placeholder="https://..." value="${escapeAttr(url)}">
    <button type="button">✕</button>
  `;
  row.querySelector("button").onclick = () => row.remove();
  linksContainer.appendChild(row);
}

function getLinksFromForm() {
  const rows = linksContainer.querySelectorAll(".link-row");
  const links = [];
  rows.forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const label = inputs[0].value.trim();
    const url = inputs[1].value.trim();
    if (url) {
      links.push({ label: label || "Buka video", url });
    }
  });
  return links;
}

function getTagsFromForm() {
  const raw = document.getElementById("tags").value.trim();
  if (!raw) return [];
  return raw.split(",").map(t => t.trim()).filter(Boolean);
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}

document.getElementById("addLinkBtn").onclick = () => addLinkRow();
addLinkRow(); // baris kosong pertama saat halaman dibuka

function resetForm() {
  editingId = null;
  editingExistingPhotos = [];
  editingCode = null;
  removedExistingPhotos = [];
  formTitle.textContent = "Tambah Konten Baru";
  submitBtn.textContent = "Bagikan Konten";
  cancelEditBtn.style.display = "none";
  document.getElementById("photos").value = "";
  document.getElementById("preview").innerHTML = "";
  existingPreview.innerHTML = "";
  linksContainer.innerHTML = "";
  addLinkRow();
  document.getElementById("tags").value = "";
  document.getElementById("caption").value = "";
  document.getElementById("resultLink").style.display = "none";
  selectedFiles = [];
  formMsg.textContent = "";
}

cancelEditBtn.onclick = resetForm;

submitBtn.onclick = async () => {
  formMsg.className = "msg";
  formMsg.textContent = "";

  const links = getLinksFromForm();
  const tags = getTagsFromForm();
  const caption = document.getElementById("caption").value.trim();

  if (selectedFiles.length === 0 && editingExistingPhotos.length === 0 && links.length === 0 && !caption) {
    formMsg.className = "msg error";
    formMsg.textContent = "Isi minimal satu: foto, link, atau catatan.";
    return;
  }

  submitBtn.disabled = true;
  formMsg.textContent = "Memproses...";

  try {
    const photoUrls = [...editingExistingPhotos];
    let i = 0;
    for (const file of selectedFiles) {
      i++;
      formMsg.textContent = `Mengunggah foto ${i} dari ${selectedFiles.length}...`;
      const url = await uploadToCloudflare(file);
      photoUrls.push(url);
    }

    formMsg.textContent = "Menyimpan data...";

    if (editingId) {
      if (!editingCode) {
        formMsg.textContent = "Membuat kode link...";
        editingCode = await generateUniqueCode();
      }
      await updateDoc(doc(db, "posts", editingId), {
        photoUrls,
        links,
        tags,
        caption: caption || null,
        code: editingCode
      });
      formMsg.className = "msg success";
      formMsg.textContent = "Materi berhasil diperbarui!";

      // Foto lama yang dibuang/diganti selama sesi edit ini BARU sekarang
      // benar-benar dihapus dari R2 -- setelah dipastikan perubahan post-nya
      // berhasil tersimpan (bukan saat tombol ✕ diklik), supaya kalau admin
      // batal edit, foto lama tidak ikut kehapus sia-sia.
      if (removedExistingPhotos.length > 0) {
        deleteFromCloudflare(removedExistingPhotos);
        removedExistingPhotos = [];
      }

      const editedUrl = `${window.location.origin}/p/${editingCode}`;
      const editedResultEl = document.getElementById("resultLink");
      editedResultEl.style.display = "block";
      editedResultEl.innerHTML = `Link konten ini:<br><b>${editedUrl}</b><br><button type="button" class="shareBtn" style="width:auto; margin-top:8px; padding:8px 14px; font-size:12px; border-radius:6px; color:#fff; border:none; cursor:pointer;">${shareIconSvg}Bagikan</button>`;
      editedResultEl.querySelector(".shareBtn").onclick = () => sharePostLink(editedUrl);

      resetFieldsOnly();
    } else {
      formMsg.textContent = "Membuat kode link...";
      const code = await generateUniqueCode();
      const docRef = await addDoc(collection(db, "posts"), {
        photoUrls,
        links,
        tags,
        caption: caption || null,
        code,
        createdAt: serverTimestamp()
      });
      formMsg.className = "msg success";
      formMsg.textContent = "Berhasil dibagikan konten!";

      const postUrl = `${window.location.origin}/p/${code}`;
      const resultEl = document.getElementById("resultLink");
      resultEl.style.display = "block";
      resultEl.innerHTML = `Link khusus konten ini:<br><b>${postUrl}</b><br><button type="button" class="shareBtn" style="width:auto; margin-top:8px; padding:8px 14px; font-size:12px; border-radius:6px; color:#fff; border:none; cursor:pointer;">${shareIconSvg}Bagikan</button>`;
      resultEl.querySelector(".shareBtn").onclick = () => sharePostLink(postUrl);
      resetFieldsOnly();
    }
  } catch (err) {
    formMsg.className = "msg error";
    formMsg.textContent = "Gagal: " + err.message;
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
};

function resetFieldsOnly() {
  document.getElementById("photos").value = "";
  document.getElementById("preview").innerHTML = "";
  selectedFiles = [];
  if (!editingId) {
    linksContainer.innerHTML = "";
    addLinkRow();
    document.getElementById("tags").value = "";
    document.getElementById("caption").value = "";
  }
}

function startEdit(id, data) {
  editingId = id;
  editingExistingPhotos = data.photoUrls || [];
  editingCode = data.code || null;
  removedExistingPhotos = [];
  selectedFiles = [];
  document.getElementById("preview").innerHTML = "";
  formTitle.textContent = "Edit konten";
  submitBtn.textContent = "Simpan Perubahan";
  cancelEditBtn.style.display = "block";

  linksContainer.innerHTML = "";
  const existingLinks = data.links || (data.taskLink ? [{ label: "Buka video", url: data.taskLink }] : []);
  if (existingLinks.length === 0) {
    addLinkRow();
  } else {
    existingLinks.forEach(l => addLinkRow(l.label, l.url));
  }

  document.getElementById("tags").value = (data.tags || []).join(", ");
  document.getElementById("caption").value = data.caption || "";
  document.getElementById("resultLink").style.display = "none";

  existingPreview.innerHTML = "";
  renderExistingPreview();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderExistingPreview() {
  existingPreview.innerHTML = "";
  editingExistingPhotos.forEach((url) => {
    const wrap = document.createElement("div");
    wrap.className = "preview-item";
    wrap.innerHTML = `
      <img src="${url}" title="Foto lama">
      <button type="button" class="editCropBtn" title="Ganti foto ini"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg></button>
      <button type="button" class="removeBtn" title="Hapus foto"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    `;
    wrap.querySelector(".removeBtn").onclick = () => {
      editingExistingPhotos = editingExistingPhotos.filter(u => u !== url);
      removedExistingPhotos.push(url);
      renderExistingPreview();
    };
    wrap.querySelector(".editCropBtn").onclick = () => {
      // Foto lama sudah ter-hosting di server (bukan file lokal), jadi tidak
      // bisa dibuka ulang untuk di-crop langsung (kendala CORS canvas).
      // Solusinya: pilih foto baru sebagai pengganti, lalu foto baru itu
      // yang melewati alur cropping seperti biasa.
      const swapInput = document.createElement("input");
      swapInput.type = "file";
      swapInput.accept = "image/*";
      swapInput.style.display = "none";
      swapInput.onchange = async () => {
        const file = swapInput.files[0];
        swapInput.remove();
        if (!file) return;
        const cropped = await openCropperForFile(file);
        if (cropped) {
          editingExistingPhotos = editingExistingPhotos.filter(u => u !== url);
          removedExistingPhotos.push(url);
          selectedFiles.push(makeCroppedFile(cropped, file.name));
          renderExistingPreview();
          renderNewPreview();
        }
      };
      document.body.appendChild(swapInput);
      swapInput.click();
    };
    existingPreview.appendChild(wrap);
  });
}

async function removePost(id, photoUrls) {
  if (!confirm("Yakin hapus materi ini? Tidak bisa dikembalikan.")) return;
  try {
    await deleteDoc(doc(db, "posts", id));
    // Post-nya sudah pasti terhapus dari Firestore -- sekarang hapus juga
    // semua foto post ini dari Cloudflare R2 supaya tidak jadi file yatim
    // yang menumpuk (tetap memakan kuota storage walau tidak terpakai lagi).
    if (photoUrls && photoUrls.length > 0) {
      deleteFromCloudflare(photoUrls);
    }
  } catch (err) {
    alert("Gagal menghapus: " + err.message);
  }
}

function listenPosts() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const listEl = document.getElementById("postList");
    if (snapshot.empty) {
      listEl.innerHTML = '<p class="empty">Belum ada materi.</p>';
      return;
    }
    listEl.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const date = data.createdAt?.toDate
        ? data.createdAt.toDate().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";

      const thumbs = (data.photoUrls || [])
        .map(url => `<img src="${url}">`)
        .join("");

      const linksList = data.links || (data.taskLink ? [{ label: "Buka Link", url: data.taskLink }] : []);
      const linksHtml = linksList
        .map(l => `<div class="link">${linkIconSvgSmall}${escapeHtml(l.label)}: ${escapeHtml(l.url)}</div>`)
        .join("");

      const tagsList = data.tags || [];
      const tagsHtml = tagsList.length
        ? `<div class="link">${tagIconSvgSmall}${tagsList.map(t => escapeHtml(t)).join(", ")}</div>`
        : "";

      const item = document.createElement("div");
      item.className = "post-item";
      item.innerHTML = `
        <div class="date">${date}</div>
        ${data.caption ? `<div class="caption">${escapeHtml(data.caption)}</div>` : ""}
        <div class="thumbs">${thumbs}</div>
        ${linksHtml}
        ${tagsHtml}
        <div class="actions">
          <button class="editBtn">Edit</button>
          <button class="shareBtn">Bagikan</button>
          <button class="deleteBtn">Hapus</button>
        </div>
      `;
      const postUrl = data.code
        ? `${window.location.origin}/p/${data.code}`
        : `${window.location.origin}/?post=${docSnap.id}`;
      item.querySelector(".editBtn").onclick = () => startEdit(docSnap.id, data);
      item.querySelector(".shareBtn").onclick = () => sharePostLink(postUrl);
      item.querySelector(".deleteBtn").onclick = () => removePost(docSnap.id, data.photoUrls);
      listEl.appendChild(item);
    });
  });
}

async function loadContactSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "contact"));
    if (snap.exists()) {
      const data = snap.data();
      document.getElementById("contactTelegram").value = data.telegram || "";
      document.getElementById("contactFacebook").value = data.facebook || "";
      document.getElementById("contactWhatsapp").value = data.whatsapp || "";
    }
  } catch (err) {
    console.error("Gagal memuat pengaturan kontak:", err);
  }
}

document.getElementById("saveContactBtn").onclick = async () => {
  const msgEl = document.getElementById("contactMsg");
  msgEl.className = "msg";
  msgEl.textContent = "Menyimpan...";
  try {
    await setDoc(doc(db, "settings", "contact"), {
      telegram: document.getElementById("contactTelegram").value.trim() || null,
      facebook: document.getElementById("contactFacebook").value.trim() || null,
      whatsapp: document.getElementById("contactWhatsapp").value.trim() || null
    });
    msgEl.className = "msg success";
    msgEl.textContent = "Pengaturan link sosmed berhasil disimpan!";
  } catch (err) {
    msgEl.className = "msg error";
    msgEl.textContent = "Gagal: " + err.message;
  }
};

async function sharePostLink(url) {
  const shareData = { url: url };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      // Pengguna membatalkan share, tidak perlu ditampilkan sebagai error
    }
  } else if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url);
      alert("Link disalin! Silakan tempel ke aplikasi yang diinginkan.");
    } catch (err) {
      prompt("Salin link ini secara manual:", url);
    }
  } else {
    prompt("Salin link ini secara manual:", url);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}