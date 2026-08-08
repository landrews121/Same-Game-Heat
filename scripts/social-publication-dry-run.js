#!/usr/bin/env node
const fs = require("node:fs/promises");
const path = require("node:path");
const { createSocialManager } = require("../social-manager");
const { verifyPublicationIntegrity } = require("../social-publications");

const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { board: "", format: "feed", contentType: "DAILY_3", uploadAsset: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--board") args.board = argv[index += 1] || "";
    else if (arg === "--format") args.format = argv[index += 1] || "feed";
    else if (arg === "--content-type") args.contentType = argv[index += 1] || "DAILY_3";
    else if (arg === "--upload-asset") args.uploadAsset = true;
  }
  return args;
}

async function loadDotEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const split = trimmed.indexOf("=");
      const key = trimmed.slice(0, split).trim();
      let value = trimmed.slice(split + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    // .env is optional for local tests.
  }
}

function captureResponse() {
  const capture = { status: 0, headers: {}, body: "" };
  return {
    capture,
    writeHead(code, headers = {}) {
      capture.status = code;
      capture.headers = headers;
    },
    end(body = "") {
      capture.body = body;
    }
  };
}

async function route(manager, cookie, { method = "GET", pathname, body = null }) {
  const response = captureResponse();
  await manager.handle(
    { method, headers: cookie ? { cookie } : {} },
    response,
    new URL(`http://localhost${pathname}`),
    async () => body ? JSON.stringify(body) : ""
  );
  const payload = response.capture.body ? JSON.parse(response.capture.body) : {};
  if (response.capture.status >= 400) {
    throw new Error(`${method} ${pathname} failed: ${payload.error || response.capture.status}`);
  }
  return { ...payload, status: response.capture.status, headers: response.capture.headers };
}

async function main() {
  await loadDotEnv(path.join(root, ".env"));
  const args = parseArgs(process.argv.slice(2));
  if (!args.board) {
    throw new Error("Missing --board path. Export the browser board JSON and pass it here.");
  }

  const env = {
    ...process.env,
    SOCIAL_PUBLISH_DRY_RUN: "true",
    SOCIAL_DRY_RUN_UPLOAD_ASSET: args.uploadAsset ? "true" : process.env.SOCIAL_DRY_RUN_UPLOAD_ASSET || "false"
  };
  const adminSecret = env.SOCIAL_ADMIN_SECRET || "local-dry-run-secret";
  env.SOCIAL_ADMIN_SECRET = adminSecret;

  const board = JSON.parse(await fs.readFile(path.resolve(args.board), "utf8"));
  const officialPicks = board.officialPicks || [];
  if (!officialPicks.length) throw new Error("Board JSON does not include officialPicks.");

  const manager = createSocialManager({ root, env });
  const login = await route(manager, "", {
    method: "POST",
    pathname: "/api/social/login",
    body: { secret: adminSecret }
  });
  const cookie = login.headers["Set-Cookie"];

  const generated = await route(manager, cookie, {
    method: "POST",
    pathname: "/api/social/generate",
    body: {
      contentType: args.contentType,
      board,
      allowDuplicate: true
    }
  });
  const content = generated.content;

  const approvedContent = await route(manager, cookie, {
    method: "POST",
    pathname: `/api/social/content/${content.id}/approve`,
    body: {}
  });

  const graphicResponse = await route(manager, cookie, {
    method: "POST",
    pathname: `/api/social/content/${content.id}/graphics`,
    body: { format: args.format }
  });
  const graphic = graphicResponse.graphic;

  const approvedGraphic = await route(manager, cookie, {
    method: "POST",
    pathname: `/api/social/graphics/${graphic.id}/approve`,
    body: {}
  });

  const prepared = await route(manager, cookie, {
    method: "POST",
    pathname: `/api/social/graphics/${graphic.id}/prepare-publication`,
    body: {}
  });
  const publication = prepared.publication;

  const dryPublish = await route(manager, cookie, {
    method: "POST",
    pathname: `/api/social/publications/${publication.id}/publish`,
    body: {}
  });
  const receipt = verifyPublicationIntegrity(dryPublish.publication);

  const report = {
    ranAt: new Date().toISOString(),
    dryRun: true,
    uploadedSupabaseAsset: Boolean(args.uploadAsset),
    board: {
      slateDate: board.slateDate,
      sport: board.sport,
      sportsbook: board.sportsbook,
      officialPickCount: officialPicks.length
    },
    checks: {
      contentApproved: approvedContent.content.status === "approved",
      graphicApproved: approvedGraphic.graphic.status === "approved",
      assetPrepared: Boolean(receipt.assetHash && receipt.assetUrl),
      instagramNotCalled: receipt.status === "prepared" && !receipt.platformMediaId,
      publicationIntegrity: receipt.integrityStatus
    },
    ids: {
      socialContentId: content.id,
      socialGraphicId: graphic.id,
      publicationId: receipt.id
    },
    receipt: {
      status: receipt.status,
      publicationType: receipt.publicationType,
      caption: receipt.caption,
      assetUrl: receipt.assetUrl,
      assetHash: receipt.assetHash,
      snapshotIds: receipt.snapshotIds,
      snapshotHashes: receipt.snapshotHashes,
      resultIds: receipt.resultIds,
      resultHashes: receipt.resultHashes,
      platformMediaId: receipt.platformMediaId,
      permalink: receipt.permalink,
      apiVersion: receipt.apiVersion,
      provider: receipt.provider,
      publicationHash: receipt.publicationHash,
      integrityStatus: receipt.integrityStatus
    }
  };

  const outDir = path.join(root, ".social-dry-runs");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `publication-dry-run-${Date.now()}.json`);
  await fs.writeFile(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, reportFile: outFile, checks: report.checks }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
