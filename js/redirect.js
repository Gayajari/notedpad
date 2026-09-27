import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================== SLOT IKLAN BANNER 300x250 ==================
   Dibungkus iframe sandbox: script iklan tetap tampil & lapor impresi
   normal, tapi TIDAK BISA memicu redirect/navigasi sendiri tanpa klik
   manual pengguna. Ini penting di halaman ini karena ada redirect timer
   bawaan kita sendiri (goToTarget) -- kalau iklan dibiarkan bebas, dia
   bisa "menyerobot" navigasi duluan sebelum timer selesai, dan pengunjung
   nyasar ke halaman iklan alih-alih ke Telegram/WA. */
(function () {
  const ADS_ZONE_SQUARE = { key: "8eb886ab4511979ddc3b249d33e34725", width: 300, height: 250 };

  function buildAdsIframe(zone) {
    const iframe = document.createElement("iframe");
    iframe.width = String(zone.width);
    iframe.height = String(zone.height);
    iframe.scrolling = "no";
    iframe.loading = "lazy";
    // allow-scripts + allow-same-origin: iklan butuh JS untuk render & lapor impresi.
    // allow-popups + allow-popups-to-escape-sandbox + allow-top-navigation-by-user-activation:
    // klik manual pengunjung ke iklan tetap berfungsi normal,
    // tapi script TIDAK BISA memaksa redirect/tab baru tanpa klik.
    iframe.sandbox = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;overflow:hidden;}</style></head><body>
      <script>
        atOptions = { 'key': '${zone.key}', 'format': 'iframe', 'height': ${zone.height}, 'width': ${zone.width}, 'params': {} };
      <\/script>
      <script src="https://inputoppose.com/${zone.key}/invoke.js"><\/script>
    </body></html>`;
    return iframe;
  }

  document.getElementById("adSlot").appendChild(buildAdsIframe(ADS_ZONE_SQUARE));
})();

/* ================== FIREBASE: AMBIL TAUTAN TUJUAN ================== */

const firebaseConfig = {
  apiKey: "AIzaSyDHC1apydBUTxsz3ZhJUhw4ukNIb9WD90E",
  authDomain: "notepad-d9f0b.firebaseapp.com",
  projectId: "notepad-d9f0b",
  storageBucket: "notepad-d9f0b.firebasestorage.app",
  messagingSenderId: "1081281593555",
  appId: "1:1081281593555:web:ab931db0e2282f8e325426"
};

// Link sosmed disimpan di document tunggal settings/contact (bukan collection per-id)
const COLLECTION_NAME = "settings";
const DOCUMENT_ID = "contact";

// key kiri = nilai parameter ?to=, value kanan = nama field di Firestore (settings/contact)
const FIELD_MAP = {
  telegram: "telegram",
  whatsapp: "whatsapp",
  tutorial: "facebook"
};

const DURATION = 5; // detik jeda iklan

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Sama seperti index.js -- cache lokal biar link Telegram/WhatsApp/Tutorial
// yang sering diklik pengunjung tidak perlu selalu tarik ulang dari server.
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Cache lokal Firestore tidak aktif:", err.code || err);
});

const params = new URLSearchParams(window.location.search);
const toParam = params.get('to');

// Warna tema mengikuti platform tujuan
const THEME_MAP = {
  telegram: { main: "#2AABEE", dark: "#1f8fc9" },
  whatsapp: { main: "#25D366", dark: "#1da851" },
  tutorial: { main: "#2b3a67", dark: "#1f2c50" }
};

if (toParam && THEME_MAP[toParam]) {
  document.documentElement.style.setProperty('--brand', THEME_MAP[toParam].main);
}

const countdownEl = document.getElementById('countdown');
const skipBtn = document.getElementById('skipBtn');
const statusText = document.getElementById('statusText');

let targetURL = null;

async function loadTargetURL() {
  if (!toParam || !FIELD_MAP[toParam]) {
    statusText.innerHTML = '<span class="error-text">Tautan tujuan tidak valid.</span>';
    skipBtn.style.display = 'none';
    return;
  }

  try {
    const docRef = doc(db, COLLECTION_NAME, DOCUMENT_ID);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      statusText.innerHTML = '<span class="error-text">Data tidak ditemukan.</span>';
      skipBtn.style.display = 'none';
      return;
    }

    const data = docSnap.data();
    const fieldName = FIELD_MAP[toParam];
    targetURL = data[fieldName];

    if (!targetURL) {
      statusText.innerHTML = '<span class="error-text">Tautan belum diisi.</span>';
      skipBtn.style.display = 'none';
      return;
    }

    startCountdown();
  } catch (err) {
    console.error(err);
    statusText.innerHTML = '<span class="error-text">Gagal memuat tautan. Coba lagi nanti.</span>';
    skipBtn.style.display = 'none';
  }
}

function startCountdown() {
  let remaining = DURATION;
  countdownEl.textContent = remaining;

  const timer = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;

    if (remaining <= 0) {
      clearInterval(timer);
      countdownEl.textContent = "✓";
      statusText.textContent = "Siap! Klik tombol di bawah untuk lanjut.";
      skipBtn.classList.add('active');
      setTimeout(goToTarget, 500);
    }
  }, 1000);
}

window.goToTarget = function() {
  if (targetURL) {
    window.location.href = targetURL;
  }
};

loadTargetURL();
