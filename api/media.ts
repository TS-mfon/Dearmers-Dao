import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GridFSBucket, ObjectId } from "mongodb";
import { database } from "./_db.js";
import { method, json, safeError } from "./_http.js";

const maxBytes = 2_500_000;
const mimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "POST") {
      const { fileName, mimeType, data } = req.body || {};
      if (!fileName || !mimeTypes.has(mimeType) || typeof data !== "string") return json(res, 400, { error: "Use a PNG, JPEG, WebP, or SVG image." });
      const bytes = Buffer.from(data, "base64");
      if (!bytes.length || bytes.length > maxBytes) return json(res, 413, { error: "Images must be smaller than 2.5 MB." });
      const db = await database();
      const bucket = new GridFSBucket(db, { bucketName: "media" });
      const id = new ObjectId();
      const upload = bucket.openUploadStreamWithId(id, fileName, { metadata: { contentType: mimeType, uploadedAt: new Date() } });
      await new Promise<void>((resolve, reject) => { upload.once("finish", resolve); upload.once("error", reject); upload.end(bytes); });
      return json(res, 200, { ok: true, url: `/api/media?id=${id.toHexString()}`, id: id.toHexString() });
    }
    if (!method(req, res, ["GET"])) return;
    const id = String(req.query.id || "");
    if (!ObjectId.isValid(id)) return json(res, 400, { error: "Invalid media id." });
    const db = await database();
    const bucket = new GridFSBucket(db, { bucketName: "media" });
    const file = await db.collection("media.files").findOne({ _id: new ObjectId(id) });
    if (!file) return json(res, 404, { error: "Media not found." });
    const metadata = file.metadata as { contentType?: string } | undefined;
    res.status(200).setHeader("content-type", metadata?.contentType || "application/octet-stream").setHeader("cache-control", "public, max-age=31536000, immutable");
    bucket.openDownloadStream(new ObjectId(id)).pipe(res as never);
  } catch (error) { return json(res, 500, { error: safeError(error) }); }
}
