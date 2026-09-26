import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

// Ambil ENV dan bersihkan spasi/enter tersembunyi
function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : value;
}

export default async function handler(req, res) {
  // =========================================================
  // METHOD
  // =========================================================
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  // =========================================================
  // ENVIRONMENT VARIABLES
  // =========================================================
  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  const bucketName = getEnv("R2_BUCKET_NAME");
  const publicBaseUrl = getEnv("R2_PUBLIC_BASE_URL");

  // =========================================================
  // VALIDASI ENV
  // =========================================================
  const missing = [];

  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucketName) missing.push("R2_BUCKET_NAME");
  if (!publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");

  if (missing.length > 0) {
    return res.status(500).json({
      error:
        "Environment variable belum diisi di Vercel: " +
        missing.join(", "),
    });
  }

  // =========================================================
  // VALIDASI ACCOUNT ID
  // =========================================================
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    return res.status(500).json({
      error:
        `R2_ACCOUNT_ID salah format. ` +
        `Harus 32 karakter huruf/angka tanpa https:// ` +
        `dan tanpa .r2.cloudflarestorage.com. ` +
        `Panjang saat ini: ${accountId.length}`,
    });
  }

  // =========================================================
  // ENDPOINT R2
  // =========================================================
  const r2Endpoint =
    `https://${accountId}.r2.cloudflarestorage.com`;

  // =========================================================
  // S3 CLIENT
  // =========================================================
  // Untuk Cloudflare R2:
  // - region = auto
  // - endpoint = endpoint R2 berdasarkan Account ID
  // - TIDAK menggunakan forcePathStyle
  // =========================================================
  const s3 = new S3Client({
    region: "auto",
    endpoint: r2Endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  try {
    // =======================================================
    // AMBIL DATA REQUEST
    // =======================================================
    const body = req.body || {};

    const filename = body.filename;
    const contentType = body.contentType;
    let dataBase64 = body.dataBase64;

    // =======================================================
    // VALIDASI FILE
    // =======================================================
    if (!dataBase64) {
      return res.status(400).json({
        error: "File kosong",
      });
    }

    if (typeof dataBase64 !== "string") {
      return res.status(400).json({
        error: "Format data file tidak valid",
      });
    }

    // =======================================================
    // SUPPORT DATA URL
    // Contoh:
    // data:image/jpeg;base64,/9j/4AAQ...
    //
    // Jika frontend mengirim format seperti itu,
    // bagian "data:image/jpeg;base64," harus dibuang.
    // =======================================================
    if (dataBase64.includes(",")) {
      dataBase64 = dataBase64.split(",").pop();
    }

    // Hilangkan spasi/newline
    dataBase64 = dataBase64.replace(/\s/g, "");

    if (!dataBase64) {
      return res.status(400).json({
        error: "Data Base64 kosong",
      });
    }

    // =======================================================
    // CONVERT BASE64 -> BUFFER
    // =======================================================
    let buffer;

    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch (decodeError) {
      console.error("Base64 decode error:", decodeError);

      return res.status(400).json({
        error: "Data gambar tidak valid",
      });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        error: "Ukuran file 0 byte",
      });
    }

    // =======================================================
    // BATASI 10 MB
    // =======================================================
    const maxSize = 10 * 1024 * 1024;

    if (buffer.length > maxSize) {
      return res.status(413).json({
        error: "Ukuran file terlalu besar. Maksimal 10 MB.",
      });
    }

    // =======================================================
    // NAMA FILE / EXTENSION
    // =======================================================
    let ext = "jpg";

    if (typeof filename === "string" && filename.includes(".")) {
      const originalExt = filename
        .split(".")
        .pop()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      if (originalExt) {
        ext = originalExt;
      }
    }

    // =======================================================
    // AMANKAN EXTENSION
    // =======================================================
    const allowedExtensions = [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "avif",
      "bmp",
      "svg",
    ];

    if (!allowedExtensions.includes(ext)) {
      ext = "jpg";
    }

    // =======================================================
    // BUAT KEY FILE DI R2
    // =======================================================
    const key =
      `posts/${Date.now()}-${randomUUID()}.${ext}`;

    // =======================================================
    // CONTENT TYPE
    // =======================================================
    let finalContentType =
      typeof contentType === "string" && contentType.trim()
        ? contentType.trim()
        : "image/jpeg";

    // Pastikan hanya tipe image yang digunakan
    if (!finalContentType.startsWith("image/")) {
      finalContentType = "image/jpeg";
    }

    // =======================================================
    // UPLOAD KE CLOUDFLARE R2
    // =======================================================
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: finalContentType,
      })
    );

    // =======================================================
    // PUBLIC URL
    // =======================================================
    const cleanPublicBaseUrl =
      publicBaseUrl.replace(/\/+$/, "");

    const publicUrl =
      `${cleanPublicBaseUrl}/${key}`;

    // =======================================================
    // RESPONSE SUKSES
    // =======================================================
    return res.status(200).json({
      success: true,
      url: publicUrl,
      key,
      filename: filename || null,
      contentType: finalContentType,
      size: buffer.length,
    });

  } catch (err) {
    // =======================================================
    // ERROR
    // =======================================================
    console.error("R2 UPLOAD ERROR:", err);

    let message = "Upload ke Cloudflare R2 gagal.";

    if (err?.message) {
      message = err.message;
    }

    return res.status(500).json({
      success: false,
      error: message,
    });
  }
}