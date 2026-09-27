import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { verifyAdminRequest } from "../lib/verifyAuth.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

// trim() jaga-jaga kalau saat paste value env var di dashboard Vercel
// kebawa spasi/enter tersembunyi (sering kejadian kalau copy-paste dari HP) —
// satu karakter tersembunyi saja di ACCOUNT_ID bisa merusak hostname endpoint
// dan memicu error "SSL handshake failure" yang membingungkan.
function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Cuma admin yang sudah login di /dasbor yang boleh upload -- mencegah
  // siapa saja dari luar memanggil endpoint ini langsung untuk mengisi
  // bucket R2 dengan file sembarangan.
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) {
    return res.status(401).json({ error: auth.error });
  }

  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const bucketName = getEnv("R2_BUCKET_NAME");
  const publicBaseUrl = getEnv("R2_PUBLIC_BASE_URL");

  // Validasi eksplisit SEBELUM connect ke R2 -- kalau ada yang kosong/belum
  // diisi di Vercel, pesan error langsung menyebutkan nama variabelnya,
  // bukan error jaringan/SSL yang membingungkan seperti sebelumnya.
  const missing = [];
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucketName) missing.push("R2_BUCKET_NAME");
  if (!publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");
  if (missing.length > 0) {
    return res.status(500).json({
      error: `Environment variable belum diisi di Vercel: ${missing.join(", ")}`,
    });
  }

  // Account ID R2 seharusnya string hex 32 karakter (huruf a-f/angka saja).
  // Kalau formatnya aneh (misal ke-paste sertaan "https://" atau
  // ".r2.cloudflarestorage.com"), kasih tahu di pesan error daripada
  // lanjut connect dan gagal dengan SSL error yang tidak jelas.
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    return res.status(500).json({
      error: `R2_ACCOUNT_ID sepertinya salah format (harus 32 karakter huruf/angka saja, tanpa "https://" atau ".r2.cloudflarestorage.com"). Nilai saat ini panjangnya ${accountId.length} karakter.`,
    });
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    // WAJIB untuk Cloudflare R2: tanpa ini, AWS SDK membentuk URL virtual-hosted
    // style (nama-bucket.account-id.r2.cloudflarestorage.com), tapi sertifikat
    // SSL R2 tidak mendukung format itu -> muncul "SSL handshake failure".
    // forcePathStyle memaksa format path-style yang didukung penuh oleh R2.
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const { filename, contentType, dataBase64 } = req.body || {};
    if (!dataBase64) {
      return res.status(400).json({ error: "File kosong" });
    }

    const buffer = Buffer.from(dataBase64, "base64");
    const ext = filename && filename.includes(".") ? filename.split(".").pop() : "jpg";
    const key = `posts/${Date.now()}-${randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType || "image/jpeg",
      })
    );

    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Upload gagal" });
  }
}
