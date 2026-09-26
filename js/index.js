import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

const postsEl = document.getElementById("posts");
const shortCodeMatch = window.location.pathname.match(/^\/p\/([A-Za-z]{6})\/?$/);
const shortCode = shortCodeMatch ? shortCodeMatch[1] : null;
const postIdParam = new URLSearchParams(window.location.search).get("post");
const tagParam = new URLSearchParams(window.location.search).get("tag");

// Kode pendek (domain/p/KODE) dicocokkan ke doc id lewat field "code".
// Link lama (?post=id) tetap didukung untuk kompatibilitas.
async function resolvePostId() {
  if (shortCode) {
    const qCode = query(collection(db, "posts"), where("code", "==", shortCode), limit(1));
    const snap = await getDocs(qCode);
    return snap.empty ? null : snap.docs[0].id;
  }
  return postIdParam;
}

let allDocsCache = [];
let searchActive = false;
const MAIN_FEED_LIMIT = 50;

// === Konfigurasi slot iklan native ===
const ADS_EVERY_N_POSTS = 4; // sisipkan 1 slot iklan tiap 4 post

// Zona iklan atOptions (dari dashboard ad network).
// Masing-masing dijalankan di dalam iframe terisolasi (srcdoc) supaya:
// 1) variabel global "atOptions" antar-zona tidak saling menimpa
// 2) auto-redirect/popup dari script iklan tidak bisa keluar dari kotaknya
//    (sandbox hanya mengizinkan klik manual, bukan redirect paksa)
const ADS_ZONE_SQUARE = { key: "8eb886ab4511979ddc3b249d33e34725", width: 300, height: 250 };
const ADS_ZONE_LEADERBOARD = { key: "c815dc8b1442b1b2e98cf2ac0376024c", width: 320, height: 50 };

function buildAdsIframe(zone) {
  const iframe = document.createElement("iframe");
  iframe.width = String(zone.width);
  iframe.height = String(zone.height);
  iframe.scrolling = "no";
  iframe.loading = "lazy";
  // allow-scripts + allow-same-origin: iklan butuh JS untuk render.
  // allow-popups-to-escape-sandbox + allow-top-navigation-by-user-activation:
  // klik manual pengguna tetap bisa membuka tab/link tujuan iklan,
  // TAPI script tidak bisa memicu redirect/popup otomatis tanpa klik.
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

loadContactBar();
loadCategoryBar();
setupSearch();

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

function loadCategoryBar() {
  const bar = document.getElementById("categoryBar");
  const qAll = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(200));
  onSnapshot(qAll, (snapshot) => {
    allDocsCache = snapshot.docs;
    renderOldPostsRotation();

    const allTags = new Set();
    snapshot.forEach((docSnap) => {
      (docSnap.data().tags || []).forEach((t) => allTags.add(t));
    });
    if (allTags.size === 0) {
      bar.innerHTML = "";
      return;
    }
    let html = `<a class="category-chip${!tagParam ? " active" : ""}" href="${window.location.origin}/">Semua</a>`;
    allTags.forEach((t) => {
      const isActive = tagParam === t;
      html += `<a class="category-chip${isActive ? " active" : ""}" href="?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`;
    });
    bar.innerHTML = html;
  });
}

function renderOldPostsRotation() {
  const wrap = document.getElementById("oldRotationWrap");
  if (!wrap) return;

  // Rotasi cuma tampil di halaman utama, bukan di mode post/tag
  if (postId || tagParam) {
    wrap.innerHTML = "";
    return;
  }

  const pool = allDocsCache.slice(MAIN_FEED_LIMIT);
  if (pool.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("oldPostsRotation") || "null");
  } catch (err) {
    saved = null;
  }

  let chosenIds;
  if (saved && saved.date === today && Array.isArray(saved.ids) && saved.ids.length > 0) {
    chosenIds = saved.ids;
  } else {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    chosenIds = shuffled.slice(0, 3).map((d) => d.id);
    try {
      localStorage.setItem("oldPostsRotation", JSON.stringify({ date: today, ids: chosenIds }));
    } catch (err) {
      // localStorage tidak tersedia, lewati saja
    }
  }

  const chosenDocs = chosenIds
    .map((id) => pool.find((d) => d.id === id))
    .filter(Boolean);

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
      if (searchActive) {
        searchActive = false;
        location.reload();
      }
      return;
    }

    renderSuggestions(qText);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runFullSearch(input.value.trim());
    }
  });

  btn.addEventListener("click", () => {
    runFullSearch(input.value.trim());
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.style.display = "none";
    suggestBox.classList.remove("show");
    suggestBox.innerHTML = "";
    if (searchActive) {
      searchActive = false;
      location.reload();
    }
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!suggestBox.contains(e.target) && e.target !== input) {
      suggestBox.classList.remove("show");
    }
  });
}

function renderSuggestions(qText) {
  const suggestBox = document.getElementById("searchSuggestions");
  const matchedTags = new Set();
  const matchedPosts = [];

  allDocsCache.forEach((docSnap) => {
    const data = docSnap.data();
    (data.tags || []).forEach((t) => {
      if (t.toLowerCase().includes(qText)) matchedTags.add(t);
    });
    if (data.caption && data.caption.toLowerCase().includes(qText)) {
      matchedPosts.push({ id: docSnap.id, caption: data.caption, code: data.code });
    }
  });

  let html = "";
  Array.from(matchedTags).slice(0, 5).forEach((t) => {
    html += `<a class="search-suggestion-item" href="?tag=${encodeURIComponent(t)}"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.41 12.4A2 2 0 0 1 2 11V4a2 2 0 0 1 2-2h7a2 2 0 0 1 1.41.59l8.18 8.18a2 2 0 0 1 0 2.83Z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg> <span class="tag-label">#${escapeHtml(t)}</span></a>`;
  });
  matchedPosts.slice(0, 5).forEach((p) => {
    const href = p.code ? `/p/${p.code}` : `?post=${p.id}`;
    html += `<a class="search-suggestion-item" href="${href}"><svg class="icon-sm" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg> ${escapeHtml(p.caption)}</a>`;
  });

  if (!html) {
    html = `<div class="search-suggestion-item" style="color:#999;">Tidak ada saran</div>`;
  }

  suggestBox.innerHTML = html;
  suggestBox.classList.add("show");
}

function runFullSearch(qTextRaw) {
  const suggestBox = document.getElementById("searchSuggestions");
  suggestBox.classList.remove("show");
  const qText = qTextRaw.toLowerCase();

  if (!qText) {
    searchActive = false;
    location.reload();
    return;
  }

  searchActive = true;
  const filtered = allDocsCache.filter((docSnap) => {
    const data = docSnap.data();
    const tags = data.tags || [];
    const matchTag = tags.some((t) => t.toLowerCase().includes(qText));
    const matchCaption = (data.caption || "").toLowerCase().includes(qText);
    return matchTag || matchCaption;
  });

  postsEl.innerHTML = "";
  const header = document.createElement("div");
  header.className = "section-title";
  header.textContent = "Hasil Pencarian";
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

function renderPost(docSnap) {
  const data = docSnap.data();
  const date = data.createdAt?.toDate
    ? data.createdAt.toDate().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
    : "";

  const photoUrls = data.photoUrls || [];
  const photos = photoUrls
    .map(url => `<img src="${url}" onclick="openLightbox('${url}')">`)
    .join("");
  const photosClass = photoUrls.length > 1 ? "post-photos multi" : "post-photos single";

  const linksList = data.links || (data.taskLink ? [{ label: "Buka video", url: data.taskLink }] : []);
  const linkBtns = linksList
    .map(l => `<a class="post-link" href="${l.url}" target="_blank" rel="noopener noreferrer"><svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:14px;height:14px;"><path d="M8 5v14l11-7Z"/></svg> ${escapeHtml(l.label)}</a>`)
    .join("");

  const caption = data.caption
    ? `<div class="post-caption">${escapeHtml(data.caption)}</div>`
    : "";

  const tagsList = data.tags || [];
  const tagsHtml = tagsList.length
    ? `<div class="post-tags">${tagsList.map(t => `<a class="tag-chip" href="?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join("")}</div>`
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
    <button class="post-share" onclick="sharePost('${shareUrl}')"><svg class="icon-sm" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg> Bagikan Konten</button>
  `;
  return post;
}

resolvePostId().then((postId) => { renderMain(postId); });

function renderMain(postId) {
if (postId) {
  getDoc(doc(db, "posts", postId)).then((docSnap) => {
    if (!docSnap.exists()) {
      postsEl.innerHTML = '<p class="empty">Materi tidak ditemukan.</p>';
      return;
    }
    postsEl.innerHTML = "";
    postsEl.appendChild(renderPost(docSnap));

    // Bar konten lainnya, live update, di bawah post yang dibagikan
    const otherWrap = document.createElement("div");
    otherWrap.id = "otherPosts";
    postsEl.appendChild(otherWrap);

    const qOthers = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(10));
    onSnapshot(qOthers, (snapshot) => {
      const others = snapshot.docs.filter(d => d.id !== postId);
      if (others.length === 0) {
        otherWrap.innerHTML = "";
        return;
      }
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
  }).catch(() => {
    postsEl.innerHTML = '<p class="empty">Gagal memuat materi.</p>';
  });
} else if (tagParam) {
  const qTag = query(collection(db, "posts"), where("tags", "array-contains", tagParam), orderBy("createdAt", "desc"));
  onSnapshot(qTag, (snapshot) => {
    if (searchActive) return;
    postsEl.innerHTML = "";
    const header = document.createElement("div");
    header.className = "section-title";
    header.textContent = `Tag: ${tagParam}`;
    postsEl.appendChild(header);

    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Belum ada konten dengan tag ini.";
      postsEl.appendChild(empty);
    } else {
      const docs = snapshot.docs;
      docs.forEach((d, idx) => {
        postsEl.appendChild(renderPost(d));
        if ((idx + 1) % ADS_EVERY_N_POSTS === 0 && idx !== docs.length - 1) {
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
 
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(MAIN_FEED_LIMIT));
  onSnapshot(q, (snapshot) => {
    if (searchActive) return;
    if (snapshot.empty) {
      postsEl.innerHTML = '<p class="empty">Belum ada konten.</p>';
      return;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);

    const groups = { hariIni: [], mingguIni: [], lebihLama: [] };

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const created = data.createdAt?.toDate ? data.createdAt.toDate() : null;
      if (created && created >= startOfToday) {
        groups.hariIni.push(docSnap);
      } else if (created && created >= sevenDaysAgo) {
        groups.mingguIni.push(docSnap);
      } else {
        groups.lebihLama.push(docSnap);
      }
    });

    postsEl.innerHTML = "";
    const sections = [
      { key: "hariIni", label: "Hari Ini" },
      { key: "mingguIni", label: "Minggu Ini" },
      { key: "lebihLama", label: "Lebih Lama" }
    ];

    // Penghitung post lintas-section, supaya iklan tersebar rata
    // sepanjang feed bukan cuma per-section.
    let globalPostIdx = 0;

    sections.forEach(({ key, label }) => {
      if (groups[key].length === 0) return;
      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = label;
      postsEl.appendChild(title);
      groups[key].forEach((docSnap) => {
        postsEl.appendChild(renderPost(docSnap));
        globalPostIdx += 1;
        if (globalPostIdx % ADS_EVERY_N_POSTS === 0) {
          postsEl.appendChild(createAdsSlot(ADS_ZONE_SQUARE, true));
        }
      });
    });
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
};
