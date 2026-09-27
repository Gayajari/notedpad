// Firebase Web API Key -- ini BUKAN rahasia (memang didesain publik oleh
// Firebase, sama seperti yang sudah tertanam di js/admin.js/index.js).
// Keamanan aslinya bukan dari menyembunyikan key ini, tapi dari verifikasi
// ID token di bawah: token cuma valid kalau orangnya benar-benar sudah
// login lewat Firebase Auth (di /dasbor).
const FIREBASE_API_KEY = "AIzaSyDHC1apydBUTxsz3ZhJUhw4ukNIb9WD90E";

// Verifikasi header "Authorization: Bearer <idToken>" ke Firebase Auth.
// Dipakai di awal setiap endpoint /api/upload dan /api/delete supaya
// cuma admin yang sudah login di /dasbor yang bisa memanggilnya --
// mencegah orang lain memanggil endpoint ini langsung dari luar situs
// untuk upload sampah atau menghapus foto sembarangan.
export async function verifyAdminRequest(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!idToken) {
    return { ok: false, error: "Tidak ada token login. Silakan login ulang di /dasbor." };
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    const data = await res.json();

    if (!res.ok || !Array.isArray(data.users) || data.users.length === 0) {
      return { ok: false, error: "Sesi login sudah tidak valid. Silakan login ulang di /dasbor." };
    }

    return { ok: true, uid: data.users[0].localId };
  } catch (err) {
    console.error("Gagal verifikasi token login:", err);
    return { ok: false, error: "Gagal memverifikasi status login." };
  }
}
