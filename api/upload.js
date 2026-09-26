import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

// Kredensial R2 diambil dari Environment Variables di dashboard Vercel:
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType || "image/jpeg",
      })
    );

    const publicUrl = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Upload gagal" });
  }
}