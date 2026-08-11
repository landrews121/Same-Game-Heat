const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { GRAPHIC_FORMATS } = require("./social-graphics");

const PUBLICATION_VERSION = "social-instagram-publication-v1";
const PUBLICATION_STATUSES = new Set([
  "draft",
  "asset_ready",
  "creating_container",
  "container_processing",
  "ready_to_publish",
  "publishing",
  "published",
  "verified",
  "failed",
  "archived",
  "prepared"
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function publicationId(payload) {
  return `pub_${sha256(canonicalStringify(payload)).slice(0, 18)}`;
}

function ensureDisclaimer(caption) {
  const text = clean(caption);
  return /21\+|bet responsibly/i.test(text) ? text : `${text}\n\n21+ | Bet responsibly.`;
}

function rejectLocalAssetUrl(assetUrl) {
  const value = clean(assetUrl);
  if (!/^https:\/\//i.test(value)) throw new Error("Publication asset must use a public HTTPS URL.");
  if (/localhost|127\.0\.0\.1|\.local|file:|\/\.social-assets\//i.test(value)) {
    throw new Error("Local asset URLs cannot be used for Instagram publishing.");
  }
  return value;
}

function publicationHashInput(publication) {
  const { id, createdAt, updatedAt, integrityStatus, integrityError, publicationHash, ...input } = publication || {};
  return input;
}

function computePublicationHash(publication) {
  return sha256(canonicalStringify(publicationHashInput(publication)));
}

function verifyPublicationIntegrity(publication) {
  if (!publication?.publicationHash) {
    return { ...publication, integrityStatus: "failed", integrityError: "Missing publicationHash" };
  }
  const expected = computePublicationHash(publication);
  if (expected !== publication.publicationHash) {
    return { ...publication, integrityStatus: "failed", integrityError: `publicationHash mismatch: expected ${expected}, stored ${publication.publicationHash}` };
  }
  return { ...publication, integrityStatus: "verified" };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createDeterministicPng({ width, height, seed }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const digest = crypto.createHash("sha256").update(seed).digest();
  const r = 236 + (digest[0] % 16);
  const g = 242 + (digest[1] % 10);
  const b = 250 + (digest[2] % 6);
  const rawRow = Buffer.alloc(1 + width * 3);
  rawRow[0] = 0;
  for (let x = 0; x < width; x += 1) {
    rawRow[1 + x * 3] = r;
    rawRow[2 + x * 3] = g;
    rawRow[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => rawRow));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function rasterizeApprovedSvg({ svgPath, svg, format = "feed", outputPath }) {
  const dimensions = GRAPHIC_FORMATS[format] || GRAPHIC_FORMATS.feed;
  const sourceSvg = svg || await fs.readFile(svgPath, "utf8");
  let bytes;
  let mimeType = "image/png";
  let extension = ".png";
  try {
    const sharp = require("sharp");
    bytes = await sharp(Buffer.from(sourceSvg)).resize(dimensions.width, dimensions.height).jpeg({ quality: 91, mozjpeg: true }).toBuffer();
    mimeType = "image/jpeg";
    extension = ".jpg";
  } catch {
    bytes = createDeterministicPng({ width: dimensions.width, height: dimensions.height, seed: sourceSvg });
  }
  const finalPath = outputPath || "";
  if (finalPath) {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(finalPath, bytes);
  }
  return {
    bytes,
    mimeType,
    extension,
    width: dimensions.width,
    height: dimensions.height,
    assetHash: sha256(bytes),
    dimensions: mimeType === "image/png" ? readPngDimensions(bytes) : { width: dimensions.width, height: dimensions.height }
  };
}

async function verifyAssetHash(filePath, expectedHash) {
  const bytes = await fs.readFile(filePath);
  const actual = sha256(bytes);
  if (actual !== expectedHash) throw new Error("Publication asset hash mismatch.");
  return actual;
}

function createPublicationRecord({
  content,
  graphic,
  asset,
  account = {},
  apiVersion = "",
  status = "asset_ready",
  dryRun = false,
  assetUploaded = false,
  now = new Date().toISOString()
}) {
  if (!PUBLICATION_STATUSES.has(status)) throw new Error("Unsupported publication status");
  const caption = ensureDisclaimer(content.caption || "");
  const core = {
    socialContentId: content.id,
    socialGraphicId: graphic.id,
    contentType: content.contentType,
    slateDate: content.slateDate,
    snapshotIds: graphic.snapshotIds || content.pickSnapshotIds || [],
    snapshotHashes: graphic.snapshotHashes || content.metadata?.snapshotHashes || [],
    resultIds: (content.metadata?.results || []).map((result) => result.id).filter(Boolean),
    resultHashes: (content.metadata?.results || []).map((result) => result.resultHash).filter(Boolean),
    platform: "instagram",
    accountId: account.accountId || "",
    accountUsername: account.username || "",
    publicationType: graphic.format === "story" ? "STORY_IMAGE" : "FEED_IMAGE",
    caption,
    captionHash: sha256(caption),
    assetUrl: asset.assetUrl || "",
    assetHash: asset.assetHash,
    assetUploaded: Boolean(assetUploaded),
    graphicRenderVersion: graphic.renderVersion,
    status,
    containerId: "",
    containerStatus: "",
    platformMediaId: "",
    permalink: "",
    attemptCount: 0,
    requestedAt: now,
    containerCreatedAt: "",
    publishedAt: "",
    verifiedAt: "",
    failedAt: "",
    lastError: "",
    apiVersion,
    provider: dryRun ? "dry-run" : "meta-instagram",
    simulatedProvider: Boolean(dryRun),
    publicationVersion: PUBLICATION_VERSION,
    dryRun,
    metadata: {
      assetMimeType: asset.mimeType,
      assetWidth: asset.width,
      assetHeight: asset.height,
      dryRunUploadEnabled: Boolean(dryRun && assetUploaded),
      safetyGate: dryRun ? "SOCIAL_PUBLISH_DRY_RUN" : ""
    }
  };
  const publicationHash = computePublicationHash(core);
  return {
    id: publicationId({ socialGraphicId: graphic.id, accountId: core.accountId, assetHash: asset.assetHash, dryRun }),
    ...core,
    publicationHash,
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  PUBLICATION_VERSION,
  PUBLICATION_STATUSES,
  sha256,
  rejectLocalAssetUrl,
  ensureDisclaimer,
  rasterizeApprovedSvg,
  verifyAssetHash,
  readPngDimensions,
  createPublicationRecord,
  computePublicationHash,
  verifyPublicationIntegrity
};
