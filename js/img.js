// Alamat gambar untuk TAMPILAN (bukan untuk disimpan).
//
// Sebagian provider internet memblokir domain penyimpanan gambar (r2.dev,
// ibb.co), sehingga foto pecah bagi pengunjung di jaringan itu -- padahal
// normal saat pakai VPN. Solusinya: gambar dilewatkan lewat domain situs
// sendiri (/img/..., lihat "rewrites" di vercel.json), jadi browser tidak
// perlu menghubungi domain yang diblokir tersebut.
//
// Data di Firestore TIDAK diubah -- tetap URL asli (dipakai juga untuk hapus
// file di R2). Pemetaan cuma terjadi saat gambar ditampilkan.
const PROXY_MAP = [
  { re: /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/(.*)$/i, to: "/img/" },
  { re: /^https:\/\/i\.ibb\.co\.com\/(.*)$/i, to: "/ibbcom/" },
  { re: /^https:\/\/i\.ibb\.co\/(.*)$/i, to: "/ibb/" },
];

export function imgSrc(url) {
  if (typeof url !== "string") return url;
  for (const { re, to } of PROXY_MAP) {
    const m = url.match(re);
    if (m) return to + m[1];
  }
  return url; // domain lain / URL lokal: apa adanya
}

// Atribut siap tempel di <img ...>: pakai jalur proxy, dan kalau gagal dimuat
// otomatis mencoba URL aslinya (jadi paling buruk sama seperti sebelumnya).
export function imgAttrs(url) {
  return `src="${imgSrc(url)}" data-orig="${url}" onerror="this.onerror=null;this.src=this.dataset.orig"`;
}
