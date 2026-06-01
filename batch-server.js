const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4100);
const dataDir = path.join(root, "data");
const stateFile = path.join(dataDir, "batch-state.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function defaultState() {
  return {
    weekOf: new Date().toISOString().slice(0, 10),
    users: [],
    items: [],
    log: []
  };
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

async function readState() {
  try {
    const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
    return {
      weekOf: saved.weekOf || defaultState().weekOf,
      users: Array.isArray(saved.users) ? saved.users : [],
      items: Array.isArray(saved.items) ? saved.items : [],
      revisions: Array.isArray(saved.revisions) ? saved.revisions : [],
      log: Array.isArray(saved.log) ? saved.log : []
    };
  } catch {
    return defaultState();
  }
}

async function writeState(nextState) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    stateFile,
    JSON.stringify(
      {
        weekOf: nextState.weekOf || defaultState().weekOf,
        users: Array.isArray(nextState.users) ? nextState.users : [],
        items: Array.isArray(nextState.items) ? nextState.items : [],
        revisions: Array.isArray(nextState.revisions) ? nextState.revisions : [],
        log: Array.isArray(nextState.log) ? nextState.log : []
      },
      null,
      2
    )
  );
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function safeFilePath(urlPath) {
  const requested = urlPath === "/" ? "/batch-scheduler.html" : decodeURIComponent(urlPath);
  const resolved = path.resolve(root, `.${requested}`);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    if (req.url === "/api/batch-state" && req.method === "GET") {
      json(res, 200, await readState());
      return;
    }

    if (req.url === "/api/batch-state" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      await writeState(payload);
      json(res, 200, { ok: true });
      return;
    }

    const filePath = safeFilePath(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (!filePath) {
      json(res, 403, { error: "Forbidden" });
      return;
    }

    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      json(res, 404, { error: "Not found" });
      return;
    }
    json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Batch Run Tracker available at http://localhost:${port}/batch-scheduler.html`);
});
