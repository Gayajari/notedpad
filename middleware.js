// ================== BLOKIR PREVIEW LINK DI SOSMED ==================
// Tujuan: begitu link situs ini dibagikan di X/Twitter, Facebook, Instagram,
// WhatsApp, Telegram, Discord, dll, tidak muncul kartu/preview apa pun --
// cuma link polos. Alasannya murni untuk promosi jangka panjang: preview
// otomatis (gambar+judul) kadang lebih gampang kena filter spam platform
// ketimbang link polos tanpa metadata apa pun.
//
// Caranya: setiap platform di atas mengirim "robot" (bukan browser manusia)
// untuk membaca halaman kita sesaat sebelum kartu preview ditampilkan.
// Robot-robot ini punya User-Agent yang khas dan gampang dikenali. Kalau
// permintaan datang dari salah satu robot itu, kita balas halaman KOSONG
// (tanpa <title>, tanpa meta, tanpa gambar) -- jadi robot itu tidak
// menemukan apa pun untuk dijadikan bahan kartu preview.
//
// Pengunjung manusia biasa (User-Agent browser normal) TIDAK kena middleware
// ini sama sekali -- mereka tetap melihat situs asli seperti biasa, secepat
// biasanya, tanpa perbedaan apa pun.
//
// CATATAN: ini tidak memblokir Googlebot/Bingbot, jadi situs tetap bisa
// terindeks mesin pencari seperti biasa. Kalau nanti mau itu juga
// diblokir, itu perubahan terpisah (tinggal minta).

export const config = {
  // Cuma halaman yang mungkin dibagikan ke orang lain -- tidak perlu
  // menyentuh /dasbor, /api/*, /css/*, /js/*, /assets/* sama sekali.
  matcher: ["/", "/p/:path*", "/redirect.html"],
};

const SOCIAL_BOT_UA = new RegExp(
  [
    "facebookexternalhit", // Facebook & Instagram (satu infrastruktur crawler)
    "Facebot",
    "Twitterbot", // X / Twitter
    "WhatsApp",
    "TelegramBot",
    "Discordbot",
    "LinkedInBot",
    "Slackbot",
    "SkypeUriPreview",
    "redditbot",
    "Pinterest",
    "vkShare",
    "line-poker", // LINE messenger
    "Embedly",
    "Iframely",
    "BingPreview", // preview link Bing/Skype, BUKAN Bingbot pengindeks
  ].join("|"),
  "i"
);

const BLANK_HTML =
  "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body></body></html>";

export default function middleware(request) {
  const userAgent = request.headers.get("user-agent") || "";

  if (SOCIAL_BOT_UA.test(userAgent)) {
    return new Response(BLANK_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Bukan bot preview sosmed -> lanjut proses normal (situs asli tampil apa adanya)
}
