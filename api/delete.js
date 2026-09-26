import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const bucketName = getEnv("R2_BUCKET_NAME");
  const publicBaseUrl = getEnv("R2_PUBLIC_BASE_URL");

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

  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(200).json({ deleted: 0 });
  }

  // Ubah URL publik jadi "key" objek R2 dengan membuang prefix base URL-nya.
  // URL yang TIDAK cocok dengan base URL kita (misal foto lama peninggalan
  // ImgBB dari sebelum migrasi) otomatis diabaikan -- aman, bukan error --
  // karena memang bukan file yang kita kelola di R2.
  const base = publicBaseUrl.replace(/\/$/, "") + "/";
  const keys = urls
    .filter((u) => typeof u === "string" && u.startsWith(base))
    .map((u) => u.slice(base.length));

  if (keys.length === 0) {
    return res.status(200).json({ deleted: 0 });
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    // DeleteObjectsCommand: hapus banyak file sekaligus dalam satu request
    // (maks 1000 key per panggilan), lebih efisien daripada satu-satu.
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      })
    );
    return res.status(200).json({ deleted: keys.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Gagal menghapus file dari Cloudflare R2" });
  }
}