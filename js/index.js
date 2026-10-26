import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { imgSrc, imgAttrs } from "/js/img.js";
import { getFirestore, enableIndexedDbPersistence, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs, getCountFromServer, updateDoc, increment, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyDHC1apydBUTxsz3ZhJUhw4ukNIb9WD90E",
  authDomain: "notepad-d9f0b.firebaseapp.com",
  projectId: "notepad-d9f0b",
  storageBucket: "notepad-d9f0b.firebasestorage.app",
  messagingSenderId: "1081281593555",
  appId: "1:1081281593555:web:ab931db0e2282f8e325426"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Cache lokal Firestore tidak aktif: situs terbuka di beberapa tab.");
  } else if (err.code === "unimplemented") {
    console.warn("Cache lokal Firestore tidak didukung browser ini.");
  } else {
    console.warn("Gagal mengaktifkan cache lokal Firestore:", err);
  }
});

const postsEl = document.getElementById("posts");
const shortCodeMatch = window.location.pathname.match(/^\/p\/([A-Za-z]{6})\/?$/);
const shortCode = shortCodeMatch ? shortCodeMatch[1] : null;
const postIdParam = new URLSearchParams(window.location.search).get("post");
const tagParam = new URLSearchParams(window.location.search).get("tag");

async function resolvePostId() {
  if (shortCode) {
    const qCode = query(collection(db, "posts"), where("code", "==", shortCode), limit(1));
    const snap = await getDocs(qCode);
    return snap.empty ? null : snap.docs[0].id;
  }
  return postIdParam;
}

let allDocsCache = [];
const ALL_DOCS_LIMIT = 200;
let totalPostsCount = null;
let totalCountSeq = 0;
let searchActive = false;
const MAIN_FEED_LIMIT = 50;
let currentSort = "terbaru";
let mainFeedDocsCache = [];

const ADS_EVERY_N_POSTS = 4;
const ADS_ZONE_SQUARE = { key: "8eb886ab4511979ddc3b249d33e34725", width: 300, height: 250 };
const ADS_ZONE_LEADERBOARD = { key: "c815dc8b1442b1b2e98cf2ac0376024c", width: 320, height: 50 };

function buildAdsIframe(zone) {
  const iframe = document.createElement("iframe");
  iframe.width = String(zone.width);
  iframe.height = String(zone.height);
  iframe.scrolling = "no";
  iframe.loading = "lazy";
  iframe.sandbox = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";
  iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;overflow:hidden;}</style></head><body>
    <script>
      atOptions = { 'key': '${zone.key}', 'format': 'iframe', 'height': ${zone.height}, 'width': ${zone.width}, 'params': {} };
    <\/script>
    <script src="https://inputoppose.com/${zone.key}/invoke.js"><\/script>
  </body></html>`;
  return iframe;
}

function createAdsSlot(zone, showLabel) {
  const wrap = document.createElement("div");
  wrap.className = "ads-native-slot";
  wrap.style.maxHeight = `${zone.height + 24}px`;
  if (showLabel) {
    const label = document.createElement("div");
    label.className = "ads-native-label";
    label.textContent = "Sponsor";
    wrap.appendChild(label);
  }
  wrap.appendChild(buildAdsIframe(zone));
  return wrap;
}

document.getElementById("headerAdsSlot").appendChild(buildAdsIframe(ADS_ZONE_LEADERBOARD));

/* ================== DOMAIN MAPPING PER-GRUP (settings/linkDomain) ==================
   Struktur data di Firestore (settings/linkDomain):
   {
     groups: [
       { target: "https://D.com", sources: ["https://A.com", "https://B.com"] },
       { target: "https://G.com", sources: ["https://E.com", "https://F.com"] },
       ...
     ]
   }

   Cara kerja replaceEmbedDomain:
   - Setiap URL dicek host-nya terhadap SEMUA grup
   - Kalau host cocok dengan salah satu sumber di grup tertentu →
     host URL diganti ke domain tujuan grup tersebut
   - Kalau tidak cocok dengan grup mana pun → URL tetap jalan apa adanya

   Kompatibilitas mundur: format lama (field "target" + "sources" tanpa groups)
   masih terbaca dan dikonversi jadi satu grup otomatis. */
let domainGroups = []; // [{ target, sources: [url, ...] }, ...]

function replaceEmbedDomain(originalUrl) {
  if (domainGroups.length === 0) return originalUrl;
  try {
    const url = new URL(originalUrl);
    for (const group of domainGroups) {
      if (!group.target || !Array.isArray(group.sources)) continue;
      const matched = group.sources.some((src) => {
        try { return new URL(src).host === url.host; } catch (e) { return false; }
      });
      if (matched) {
        const target = new URL(group.target);
        url.protocol = target.protocol;
        url.host = target.host;
        return url.toString();
      }
    }
    return originalUrl; // tidak cocok grup mana pun → tetap jalan
  } catch (err) {
    return originalUrl;
  }
}

async function loadLinkDomainSetting() {
  try {
    const snap = await getDoc(doc(db, "settings", "linkDomain"));
    if (!snap.exists()) { domainGroups = []; return; }
    const data = snap.data();

    if (Array.isArray(data.groups)) {
      // Format baru: array of groups
      domainGroups = data.groups.filter(g => g.target && Array.isArray(g.sources));
    } else if (data.target || data.domain) {
      // Format lama: satu target + sources → konversi ke satu grup
      domainGroups = [{
        target: data.target || data.domain,
        sources: Array.isArray(data.sources) ? data.sources : []
      }];
    } else {
      domainGroups = [];
    }
  } catch (err) {
    console.error("Gagal memuat pengaturan domain link:", err);
    domainGroups = [];
  }
}

(async () => {
  await loadLinkDomainSetting();
  loadContactBar();
  loadCustomChipBar();
  loadCategoryBar();
  setupSearch();
  setupSortBar();
  const postId = await resolvePostId();
  renderMain(postId);
})();

let postChipBarHtml = "";

const playIconSvg = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.18"/><path d="M10 8.3v7.4c0 .6.65 1 1.2.68l6.1-3.7c.55-.33.55-1.1 0-1.44l-6.1-3.7c-.55-.34-1.2.06-1.2.66z" fill="currentColor"/></svg>`;

function escapeHtmlAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function safeHttpUrl(url) {
  try {
    const u = new URL(String(url).trim());
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
  } catch (err) {
    return null;
  }
}

function fillChipSlots(root = document) {
  root.querySelectorAll(".post-chip-slot").forEach((el) => { el.innerHTML = postChipBarHtml; });
}

async function loadCustomChipBar() {
  try {
    const snap = await getDoc(doc(db, "settings", "chipbar"));
    if (!snap.exists()) return;
    const data = snap.data();
    let html = "";
    [1, 2, 3].forEach((n) => {
      const name = data[`chip${n}Name`];
      const href = safeHttpUrl(data[`chip${n}Link`]);
      const active = data[`chip${n}Active`] !== false;
      if (active && name && href) {
        html += `<a href="/redirect.html?to=chip${n}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`;
      }
    });
    postChipBarHtml = html ? `<div class="post-chip-bar">${html}</div>` : "";
    fillChipSlots();
  } catch (err) {
    console.error("Gagal memuat slot link fleksibel:", err);
  }
}

let allTagsCache = [];

async function loadAllTagsIndex() {
  try {
    const snap = await getDoc(doc(db, "settings", "tagIndex"));
    allTagsCache = snap.exists() ? (snap.data().allTags || []) : [];
  } catch (err) {
    console.error("Gagal memuat indeks tag:", err);
    allTagsCache = [];
  }
  renderCategoryBar();
}

async function loadContactBar() {
  try {
    const snap = await getDoc(doc(db, "settings", "contact"));
    if (!snap.exists()) return;
    const data = snap.data();
    const bar = document.getElementById("contactBar");
    let html = "";
    if (data.telegram) {
      html += `<a href="/redirect.html?to=telegram" target="_blank" rel="noopener noreferrer"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg> Telegram</a>`;
    }
    if (data.facebook) {
      html += `<a href="/redirect.html?to=tutorial" target="_blank" rel="noopener noreferrer"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg> Cara nonton</a>`;
    }
    if (data.whatsapp) {
      html += `<a href="/redirect.html?to=whatsapp" target="_blank" rel="noopener noreferrer"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.44 7.53L3 20l1.06-5.36A8.5 8.5 0 1 1 21 11.5Z"/></svg> WhatsApp</a>`;
    }
    bar.innerHTML = html;
  } catch (err) {
    console.error("Gagal memuat pengaturan kontak:", err);
  }
}

async function refreshTotalCount(snapshot) {
  const seq = ++totalCountSeq;
  let count = snapshot.size;
  if (snapshot.size >= ALL_DOCS_LIMIT) {
    try {
      const agg = await getCountFromServer(collection(db, "posts"));
      count = agg.data().count;
    } catch (err) {
      console.error("Gagal menghitung total post:", err);
    }
  }
  if (seq !== totalCountSeq) return;
  totalPostsCount = count;
  renderFeedMeta();
}

function renderFeedMeta() {
  const el = document.getElementById("feedMeta");
  if (!el) return;
  if (shortCode || postIdParam || tagParam || searchActive || totalPostsCount === null) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> <b>${totalPostsCount}</b> konten`;
}

function loadCategoryBar() {
  const qAll = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(ALL_DOCS_LIMIT));
  onSnapshot(qAll, (snapshot) => {
    allDocsCache = snapshot.docs;
    refreshTotalCount(snapshot);
    renderOldPostsRotation();
  });
  loadAllTagsIndex();
}

function renderCategoryBar() {
  const bar = document.getElementById("categoryBar");
  if (allTagsCache.length === 0) { bar.innerHTML = ""; return; }
  let html = `<a class="category-chip${!tagParam ? " active" : ""}" href="${window.location.origin}/">Semua</a>`;
  allTagsCache.forEach((t) => {
    const isActive = tagParam === t;
    html += `<a class="category-chip${isActive ? " active" : ""}" href="?tag=${encodeURIComponent(t)}">${escapeHtml(t.replace(/^#+/, ""))}</a>`;
  });
  bar.innerHTML = html;
}

function renderOldPostsRotation() {
  const wrap = document.getElementById("oldRotationWrap");
  if (!wrap) return;
  if (shortCode || postIdParam || tagParam) { wrap.innerHTML = ""; return; }

  const pool = allDocsCache.slice(MAIN_FEED_LIMIT);
  if (pool.length === 0) { wrap.innerHTML = ""; return; }

  const today = new Date().toISOString().slice(0, 10);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("oldPostsRotation") || "null"); } catch (err) { saved = null; }

  const wantedCount = Math.min(3, pool.length);
  const savedStillValid =
    saved && saved.date === today && Array.isArray(saved.ids) &&
    saved.ids.length === wantedCount &&
    saved.ids.every((id) => pool.some((d) => d.id === id));

  let chosenIds;
  if (savedStillValid) {
    chosenIds = saved.ids;
  } else {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    chosenIds = shuffled.slice(0, 3).map((d) => d.id);
    try { localStorage.setItem("oldPostsRotation", JSON.stringify({ date: today, ids: chosenIds })); } catch (err) {}
  }

  const chosenDocs = chosenIds.map((id) => pool.find((d) => d.id === id)).filter(Boolean);
  wrap.innerHTML = "";
  if (chosenDocs.length === 0) return;

  const header = document.createElement("div");
  header.className = "section-title";
  header.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> Konten Pilihan`;
  wrap.appendChild(header);
  chosenDocs.forEach((d) => wrap.appendChild(renderPost(d)));
}

function setupSearch() {
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const clearBtn = document.getElementById("clearBtn");
  const suggestBox = document.getElementById("searchSuggestions");

  input.addEventListener("input", (e) => {
    const qText = e.target.value.trim().toLowerCase();
    clearBtn.style.display = e.target.value ? "block" : "none";
    if (!qText) {
      suggestBox.classList.remove("show");
      suggestBox.innerHTML = "";
      if (searchActive) { searchActive = false; location.reload(); }
      return;
    }
    renderSuggestions(qText);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runFullSearch(input.value.trim()); }
  });

  btn.addEventListener("click", () => { runFullSearch(input.value.trim()); });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.style.display = "none";
    suggestBox.classList.remove("show");
    suggestBox.innerHTML = "";
    if (searchActive) { searchActive = false; location.reload(); }
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!suggestBox.contains(e.target) && e.target !== input) suggestBox.classList.remove("show");
  });
}

/* ================== SORT BAR ================== */
function setupSortBar() {
  const sortBarEl = document.getElementById("sortChipBar");
  if (!sortBarEl || sortBarEl._wired) return;
  sortBarEl._wired = true;
  sortBarEl.querySelectorAll(".sort-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (searchActive) return;
      sortBarEl.querySelectorAll(".sort-chip").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      currentSort = btn.dataset.sort;
      renderSortedFeed();
    });
  });
}

function renderSortedFeed() {
  if (mainFeedDocsCache.length === 0) return;
  postsEl.innerHTML = "";
  let docs = [...mainFeedDocsCache];

  if (currentSort === "terlama") {
    docs = docs.reverse();
  } else if (currentSort === "terpopuler") {
    // Logic disamakan persis dengan admin.js (sortAdminPosts): urut
    // murni dari postViews terbanyak, bukan gabungan linkClicks+postViews.
    docs = docs.sort((a, b) => (b.data().postViews || 0) - (a.data().postViews || 0));
  }
  // "terbaru" = urutan default dari Firestore (desc createdAt)

  docs.forEach((docSnap, idx) => {
    postsEl.appendChild(renderPost(docSnap));
    if ((idx + 1) % ADS_EVERY_N_POSTS === 0 && idx !== docs.length - 1) {
      postsEl.appendChild(createAdsSlot(ADS_ZONE_SQUARE, true));
    }
  });
}

function renderSuggestions(qText) {
  const suggestBox = document.getElementById("searchSuggestions");
  const matchedTags = allTagsCache.filter((t) => t.toLowerCase().includes(qText));
  const matchedPosts = [];
  allDocsCache.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.caption && data.caption.toLowerCase().includes(qText)) {
      matchedPosts.push({ id: docSnap.id, caption: data.caption, code: data.code });
    }
  });

  let html = "";
  Array.from(matchedTags).slice(0, 5).forEach((t) => {
    html += `<a class="search-suggestion-item" href="?tag=${encodeURIComponent(t)}"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.41 12.4A2 2 0 0 1 2 11V4a2 2 0 0 1 2-2h7a2 2 0 0 1 1.41.59l8.18 8.18a2 2 0 0 1 0 2.83Z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg> <span class="tag-label">${escapeHtml(t.replace(/^#+/, ""))}</span></a>`;
  });
  matchedPosts.slice(0, 5).forEach((p) => {
    const href = p.code ? `/p/${p.code}` : `?post=${p.id}`;
    html += `<a class="search-suggestion-item" href="${href}"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg> ${escapeHtml(p.caption)}</a>`;
  });
  if (!html) html = `<div class="search-suggestion-item" style="color:#999;">Tidak ada saran</div>`;
  suggestBox.innerHTML = html;
  suggestBox.classList.add("show");
}

function runFullSearch(qTextRaw) {
  const suggestBox = document.getElementById("searchSuggestions");
  suggestBox.classList.remove("show");
  const qText = qTextRaw.toLowerCase();
  if (!qText) { searchActive = false; location.reload(); return; }

  searchActive = true;
  renderFeedMeta();
  const filtered = allDocsCache.filter((docSnap) => {
    const data = docSnap.data();
    const tags = data.tags || [];
    return tags.some((t) => t.toLowerCase().includes(qText)) || (data.caption || "").toLowerCase().includes(qText);
  });

  postsEl.innerHTML = "";
  const header = document.createElement("div");
  header.className = "section-title";
  header.textContent = `Hasil Pencarian · ${filtered.length} konten`;
  postsEl.appendChild(header);

  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Tidak ada konten yang cocok.";
    postsEl.appendChild(empty);
  } else {
    filtered.forEach((d, idx) => {
      postsEl.appendChild(renderPost(d));
      if ((idx + 1) % ADS_EVERY_N_POSTS === 0 && idx !== filtered.length - 1) {
        postsEl.appendChild(createAdsSlot(ADS_ZONE_SQUARE, true));
      }
    });
  }
}

/* Hitung "dilihat" (postViews) begitu postingan muncul ke user — di
   beranda, tag, pencarian, atau halaman detail — bukan cuma pas buka
   link share. Dedup pakai sessionStorage supaya ganti-ganti sort
   (Terbaru/Terlama/Populer) yang render ulang semua post tidak
   nge-spam increment berkali-kali untuk post yang sama. */
function trackPostView(postId) {
  try {
    const seenKey = "viewedPosts";
    const seen = new Set(JSON.parse(sessionStorage.getItem(seenKey) || "[]"));
    if (seen.has(postId)) return;
    seen.add(postId);
    sessionStorage.setItem(seenKey, JSON.stringify([...seen]));
  } catch (err) {
    // sessionStorage tidak tersedia — tetap lanjut catat view-nya
  }
  updateDoc(doc(db, "posts", postId), { postViews: increment(1) }).catch((err) => {
    console.error("Gagal mencatat view post:", err);
  });
}

function renderPost(docSnap) {
  const data = docSnap.data();
  trackPostView(docSnap.id);
  const date = data.createdAt?.toDate
    ? data.createdAt.toDate().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
    : "";

  const photoUrls = data.photoUrls || [];
  const photos = photoUrls.map(url => `<img ${imgAttrs(url)} onclick="openLightbox('${imgSrc(url)}')">`) .join("");
  const photosClass = photoUrls.length > 1 ? "post-photos multi" : "post-photos single";

  const linksList = data.links || (data.taskLink ? [{ label: "Buka video", url: data.taskLink }] : []);
  const linkBtns = linksList
    .map((l, idx) => `<a class="post-link" data-link-idx="${idx}" href="${escapeHtmlAttr(replaceEmbedDomain(l.url))}" target="_blank" rel="noopener noreferrer">${playIconSvg} ${escapeHtml(l.label)}</a>`)
    .join("");

  const caption = data.caption ? `<div class="post-caption">${escapeHtml(data.caption)}</div>` : "";

  const tagsList = data.tags || [];
  const tagsHtml = tagsList.length
    ? `<div class="post-tags">${tagsList.map(t => `<a class="tag-chip" href="?tag=${encodeURIComponent(t)}">${escapeHtml(t.replace(/^#+/, ""))}</a>`).join("")}</div>`
    : "";

  const shareUrl = data.code
    ? `${window.location.origin}/p/${data.code}`
    : `${window.location.origin}/?post=${docSnap.id}`;

  const post = document.createElement("div");
  post.className = "post";
  post.innerHTML = `
    <div class="post-date">${date}</div>
    ${caption}
    ${tagsHtml}
    <div class="${photosClass}">${photos}</div>
    ${linkBtns}
    <div class="post-chip-slot"></div>
    <button class="post-share" onclick="sharePost('${shareUrl}')"><svg class="icon-sm" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg> Bagikan Konten</button>
  `;

  fillChipSlots(post);

  post.querySelectorAll(".post-link[data-link-idx]").forEach((linkEl) => {
    linkEl.addEventListener("click", () => {
      updateDoc(doc(db, "posts", docSnap.id), { linkClicks: increment(1) }).catch((err) => {
        console.error("Gagal mencatat klik link:", err);
      });
    });
  });

  return post;
}

function renderMain(postId) {
  if (postId) {
    getDoc(doc(db, "posts", postId)).then((docSnap) => {
      if (!docSnap.exists()) { postsEl.innerHTML = '<p class="empty">Materi tidak ditemukan.</p>'; return; }
      postsEl.innerHTML = "";
      postsEl.appendChild(renderPost(docSnap)); // trackPostView() sudah jalan di dalam renderPost()

      const otherWrap = document.createElement("div");
      otherWrap.id = "otherPosts";
      postsEl.appendChild(otherWrap);

      const qOthers = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(10));
      onSnapshot(qOthers, (snapshot) => {
        const others = snapshot.docs.filter(d => d.id !== postId);
        if (others.length === 0) { otherWrap.innerHTML = ""; return; }
        otherWrap.innerHTML = "";
        const title = document.createElement("div");
        title.className = "section-title";
        title.textContent = "Konten Lainnya";
        otherWrap.appendChild(title);
        others.forEach((d, idx) => {
          otherWrap.appendChild(renderPost(d));
          if ((idx + 1) % ADS_EVERY_N_POSTS === 0 && idx !== others.length - 1) {
            otherWrap.appendChild(createAdsSlot(ADS_ZONE_SQUARE, true));
          }
        });
        const seeAll = document.createElement("a");
        seeAll.className = "post-link";
        seeAll.href = window.location.origin + "/";
        seeAll.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg> Lihat Semua Konten`;
        otherWrap.appendChild(seeAll);
      });
    }).catch(() => { postsEl.innerHTML = '<p class="empty">Gagal memuat materi.</p>'; });

  } else if (tagParam) {
    const qTag = query(collection(db, "posts"), where("tags", "array-contains", tagParam), orderBy("createdAt", "desc"));
    onSnapshot(qTag, (snapshot) => {
      if (searchActive) return;
      postsEl.innerHTML = "";
      const header = document.createElement("div");
      header.className = "section-title";
      header.textContent = `Tag: ${tagParam} · ${snapshot.size} konten`;
      postsEl.appendChild(header);

      if (snapshot.empty) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Belum ada konten dengan tag ini.";
        postsEl.appendChild(empty);
      } else {
        snapshot.docs.forEach((d, idx) => {
          postsEl.appendChild(renderPost(d));
          if ((idx + 1) % ADS_EVERY_N_POSTS === 0 && idx !== snapshot.docs.length - 1) {
            postsEl.appendChild(createAdsSlot(ADS_ZONE_SQUARE, true));
          }
        });
      }

      const seeAll = document.createElement("a");
      seeAll.className = "post-link";
      seeAll.href = window.location.origin + "/";
      seeAll.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg> Lihat Semua Konten`;
      postsEl.appendChild(seeAll);
    });

  } else {
    // Homepage: flat feed dengan sort bar
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(MAIN_FEED_LIMIT));
    onSnapshot(q, (snapshot) => {
      if (searchActive) return;
      mainFeedDocsCache = snapshot.docs;
      renderSortedFeed();
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.openLightbox = function(url) {
  document.getElementById("lightbox-img").src = url;
  document.getElementById("lightbox").style.display = "flex";
};

window.sharePost = async function(url) {
  const shareData = { url };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (err) {}
  } else if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(url); alert("Link disalin! Silakan tempel ke aplikasi yang diinginkan."); }
    catch (err) { prompt("Salin link ini secara manual:", url); }
  } else {
    prompt("Salin link ini secara manual:", url);
  }
};
