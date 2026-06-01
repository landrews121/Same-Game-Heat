const STORAGE_KEY = "batch-run-tracker-v2";
const SHARED_STATE_URL = location.protocol.startsWith("http") ? "/api/batch-state" : "";
const MASTER_USER = {
  id: "master-admin",
  key: "master",
  name: "Master",
  pin: "0000",
  role: "admin",
  createdAt: "system"
};

let storageBlocked = false;
let sharedStorageAvailable = false;
let saveTimer = null;
let suppressSave = false;
const state = loadState();
initializeUsers();
let activeFilter = "all";
let activeLine = state.activeLine || "BIB";

const els = {
  plannedTotal: document.querySelector("#plannedTotal"),
  madeTotal: document.querySelector("#madeTotal"),
  remainingTotal: document.querySelector("#remainingTotal"),
  shortLines: document.querySelector("#shortLines"),
  weekLabel: document.querySelector("#weekLabel"),
  scheduleCsv: document.querySelector("#scheduleCsv"),
  importText: document.querySelector("#importText"),
  importRows: document.querySelector("#importRows"),
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginName: document.querySelector("#loginName"),
  loginPin: document.querySelector("#loginPin"),
  loginStatus: document.querySelector("#loginStatus"),
  currentUserLabel: document.querySelector("#currentUserLabel"),
  logoutButton: document.querySelector("#logoutButton"),
  adminPanel: document.querySelector("#adminPanel"),
  createUserForm: document.querySelector("#createUserForm"),
  newUserName: document.querySelector("#newUserName"),
  newUserPin: document.querySelector("#newUserPin"),
  createUserStatus: document.querySelector("#createUserStatus"),
  userList: document.querySelector("#userList"),
  productionForm: document.querySelector("#productionForm"),
  orderInput: document.querySelector("#orderInput"),
  orderDetails: document.querySelector("#orderDetails"),
  lineFilter: document.querySelector("#lineFilter"),
  madeInput: document.querySelector("#madeInput"),
  noteInput: document.querySelector("#noteInput"),
  scheduleBody: document.querySelector("#scheduleBody"),
  auditLog: document.querySelector("#auditLog"),
  changeSummaryLabel: document.querySelector("#changeSummaryLabel"),
  changeSummary: document.querySelector("#changeSummary"),
  changeDetails: document.querySelector("#changeDetails"),
  exportCsv: document.querySelector("#exportCsv"),
  clearWeek: document.querySelector("#clearWeek"),
  clearLog: document.querySelector("#clearLog"),
  auditPanel: document.querySelector("#auditPanel"),
  changesPanel: document.querySelector("#changesPanel"),
  activityTabs: document.querySelectorAll(".activity-tab")
};

document.addEventListener("dragover", (event) => {
  if (event.target.closest(".file-drop")) return;
  event.preventDefault();
});

document.addEventListener("drop", (event) => {
  if (event.target.closest(".file-drop")) return;
  event.preventDefault();
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.items) && Array.isArray(saved.log)) return saved;
  } catch {
    storageBlocked = true;
  }

  return {
    weekOf: new Date().toISOString().slice(0, 10),
    currentUserId: "",
    users: [],
    items: [],
    revisions: [],
    log: []
  };
}

function initializeUsers() {
  state.users ||= [];
  state.users.forEach((user) => {
    user.role ||= "batcher";
    user.key ||= userKey(user.name);
  });

  const master = state.users.find((user) => user.id === MASTER_USER.id || user.key === MASTER_USER.key);
  if (master) {
    Object.assign(master, { ...MASTER_USER, pin: master.pin || MASTER_USER.pin });
    return;
  }

  state.users.unshift({ ...MASTER_USER });
}

function saveState() {
  if (suppressSave) return;

  if (!storageBlocked) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      storageBlocked = true;
    }
  }

  queueSharedSave();
}

function sharedStateSnapshot() {
  return {
    weekOf: state.weekOf,
    users: state.users || [],
    items: state.items || [],
    revisions: state.revisions || [],
    log: state.log || []
  };
}

async function loadSharedState() {
  if (!SHARED_STATE_URL) return;

  try {
    const response = await fetch(SHARED_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Shared state unavailable");

    const sharedState = await response.json();
    const currentUserId = state.currentUserId || "";
    Object.assign(state, {
      weekOf: sharedState.weekOf || state.weekOf,
      users: Array.isArray(sharedState.users) ? sharedState.users : [],
      items: Array.isArray(sharedState.items) ? sharedState.items : [],
      revisions: Array.isArray(sharedState.revisions) ? sharedState.revisions : [],
      log: Array.isArray(sharedState.log) ? sharedState.log : [],
      currentUserId
    });
    sharedStorageAvailable = true;
    initializeUsers();
    suppressSave = true;
    render();
    suppressSave = false;
  } catch {
    sharedStorageAvailable = false;
  }
}

function queueSharedSave() {
  if (!SHARED_STATE_URL) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSharedState, 250);
}

async function saveSharedState() {
  if (!SHARED_STATE_URL) return;

  try {
    const response = await fetch(SHARED_STATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sharedStateSnapshot())
    });
    sharedStorageAvailable = response.ok;
  } catch {
    sharedStorageAvailable = false;
  }
}

function id() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function madeFor(item) {
  item.entries ||= [];
  return item.entries.reduce((total, entry) => total + asNumber(entry.units), 0);
}

function remainingFor(item) {
  return asNumber(item.planned) - madeFor(item);
}

function statusFor(item) {
  if (item.archived) return { key: "removed", label: "Removed latest" };
  const remaining = remainingFor(item);
  if (remaining < 0) return { key: "over", label: `Over by ${Math.abs(remaining)}` };
  if (remaining === 0) return { key: "done", label: "Complete" };
  return { key: "open", label: `${remaining} short` };
}

function orderNumberFor(item) {
  const orderMatch = String(item.product || "").match(/\border\s+([a-z0-9-]+)/i);
  return orderMatch ? orderMatch[1] : "";
}

function findCurrentItemByOrder(orderNumber) {
  const target = normalizeOrder(orderNumber);
  if (!target) return null;
  return state.items.find((item) => !item.archived && normalizeOrder(orderNumberFor(item)) === target) || null;
}

function normalizeOrder(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function lineTypeFor(item) {
  const lineText = `${item.line || ""} ${item.product || ""}`.toUpperCase();
  if (lineText.includes("BIB")) return "BIB";
  if (lineText.includes("CAN")) return "CAN";
  if (lineText.includes("BOT") || lineText.includes("PET")) return "BOT";
  return "";
}

function itemsForActiveLine() {
  return state.items.filter((item) => lineTypeFor(item) === activeLine);
}

function currentItemsForActiveLine() {
  return itemsForActiveLine().filter((item) => !item.archived);
}

function addLog(message) {
  state.log.unshift({
    id: id(),
    at: new Date().toISOString(),
    message
  });
}

function userKey(name) {
  return normalizeKey(name);
}

function currentUser() {
  state.users ||= [];
  return state.users.find((user) => user.id === state.currentUserId) || null;
}

function isAdmin(user = currentUser()) {
  return user?.role === "admin";
}

function updateAuthView() {
  state.users ||= [];
  const user = currentUser();
  document.body.classList.toggle("login-active", !user);
  els.loginScreen.classList.toggle("hidden", Boolean(user));
  els.currentUserLabel.textContent = user ? `Signed in: ${user.name}${isAdmin(user) ? " (Master)" : ""}` : "Not signed in";
  els.adminPanel.classList.toggle("hidden", !isAdmin(user));
  els.clearLog.classList.toggle("hidden", !isAdmin(user));
  els.clearLog.disabled = !isAdmin(user);
  [...els.productionForm.elements].forEach((field) => {
    field.disabled = !user;
  });
  renderUserList();

  if (!user) {
    setTimeout(() => els.loginName.focus(), 0);
  }
}

function signIn(name, pin) {
  state.users ||= [];
  const cleanName = name.trim();
  const cleanPin = pin.trim();
  if (!cleanName || !cleanPin) return { ok: false, message: "Enter a user name and PIN." };

  const existing = state.users.find((user) => user.key === userKey(cleanName));
  if (!existing) {
    return { ok: false, message: "Ask the master user to create your account." };
  }

  if (existing.pin !== cleanPin) {
    return { ok: false, message: "That PIN does not match this user." };
  }

  state.currentUserId = existing.id;
  addLog(`${existing.name} signed in.`);
  saveState();
  return { ok: true, message: "" };
}

function createBatcherAccount(name, pin) {
  if (!isAdmin()) return { ok: false, message: "Only the master login can create accounts." };

  const cleanName = name.trim();
  const cleanPin = pin.trim();
  if (!cleanName || !cleanPin) return { ok: false, message: "Enter a user name and PIN." };
  if (state.users.some((user) => user.key === userKey(cleanName))) {
    return { ok: false, message: "That user already exists." };
  }

  state.users.push({
    id: id(),
    key: userKey(cleanName),
    name: cleanName,
    pin: cleanPin,
    role: "batcher",
    createdAt: new Date().toISOString()
  });
  addLog(`${currentUser().name} created batcher account for ${cleanName}.`);
  saveState();
  return { ok: true, message: `${cleanName} can now sign in.` };
}

function renderUserList() {
  if (!isAdmin()) {
    els.userList.innerHTML = "";
    return;
  }

  els.userList.innerHTML = state.users
    .map(
      (user) => `
        <div class="user-row">
          <div>${escapeHtml(user.name)}</div>
          <span>${user.role === "admin" ? "Master" : "Batcher"}</span>
        </div>
      `
    )
    .join("");
}

function parseSchedule(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.includes(",") ? parseCsvLine(line) : line.split(/\t|\s{2,}/);
      return cells.map((cell) => cell.trim()).filter(Boolean);
    })
    .filter((cells) => cells.length >= 2)
    .map((cells) => {
      const maybeHeader = cells.join(" ").toLowerCase();
      if (maybeHeader.includes("planned") || maybeHeader.includes("product")) return null;

      const plannedIndex = cells.findLastIndex((cell) => /^\d+(\.\d+)?$/.test(cell.replace(/,/g, "")));
      if (plannedIndex === -1) return null;

      const planned = Number(cells[plannedIndex].replace(/,/g, ""));
      const line = plannedIndex >= 2 ? cells[0] : "";
      const productStart = line ? 1 : 0;
      const product = cells.slice(productStart, plannedIndex).join(" ");

      if (!product || !planned) return null;
      return { line, product, planned };
    })
    .filter(Boolean);
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell);
  return cells;
}

async function parseScheduleFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "xlsx") {
    const buffer = await file.arrayBuffer();
    return parseXlsxSchedule(buffer);
  }

  const text = await file.text();
  return parseSchedule(text);
}

async function parseXlsxSchedule(buffer) {
  const files = await unzipXlsx(buffer);
  const workbookXml = files.get("xl/workbook.xml");
  const workbookRelsXml = files.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !workbookRelsXml) {
    throw new Error("This Excel file is missing the workbook metadata.");
  }

  const sheets = workbookSheets(workbookXml);
  const rels = workbookRelationships(workbookRelsXml);
  const preferredSheet =
    sheets.find((sheet) => sheet.name.toLowerCase() === "rawdata") ||
    sheets.find((sheet) => sheet.name.toLowerCase() === "header") ||
    sheets.find((sheet) => sheet.name.toLowerCase() === "format") ||
    sheets[0];

  if (!preferredSheet) throw new Error("No sheets were found in this Excel file.");

  const sheetPath = rels.get(preferredSheet.relationshipId);
  const sheetXml = files.get(sheetPath);
  if (!sheetXml) throw new Error(`Could not read the ${preferredSheet.name} sheet.`);

  const sharedStrings = sharedStringsFromXml(files.get("xl/sharedStrings.xml") || "");
  const table = sheetRows(sheetXml, sharedStrings);
  return scheduleRowsFromTable(table);
}

async function unzipXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const files = new Map();
  const eocd = findEndOfCentralDirectory(view);
  const entries = view.getUint16(eocd + 10, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeBytes(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : await inflateZipEntry(compressed);
    files.set(name, decodeBytes(data));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("This does not look like a valid Excel workbook.");
}

async function inflateZipEntry(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot unpack Excel files. Convert the schedule to CSV first.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflated);
}

function decodeBytes(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function workbookSheets(xml) {
  const doc = parseXml(xml);
  return [...doc.getElementsByTagNameNS("*", "sheet")].map((sheet) => ({
    name: sheet.getAttribute("name") || "",
    relationshipId: sheet.getAttribute("r:id")
  }));
}

function workbookRelationships(xml) {
  const doc = parseXml(xml);
  const rels = new Map();
  [...doc.getElementsByTagNameNS("*", "Relationship")].forEach((relationship) => {
    const idValue = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target") || "";
    if (!idValue || !target.includes("worksheets/")) return;
    rels.set(idValue, normalizeXlsxPath(target.startsWith("/") ? target.slice(1) : `xl/${target}`));
  });
  return rels;
}

function normalizeXlsxPath(path) {
  const parts = [];
  path.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function sharedStringsFromXml(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  return [...doc.getElementsByTagNameNS("*", "si")].map((item) =>
    [...item.getElementsByTagNameNS("*", "t")].map((textNode) => textNode.textContent || "").join("")
  );
}

function sheetRows(xml, sharedStrings) {
  const doc = parseXml(xml);
  return [...doc.getElementsByTagNameNS("*", "row")].map((row) => {
    const cells = [];
    [...row.getElementsByTagNameNS("*", "c")].forEach((cell) => {
      const reference = cell.getAttribute("r") || "";
      const columnIndex = columnIndexFromReference(reference);
      cells[columnIndex] = cellValue(cell, sharedStrings);
    });
    return cells.map((value) => value ?? "");
  });
}

function columnIndexFromReference(reference) {
  const letters = (reference.match(/[A-Z]+/i)?.[0] || "A").toUpperCase();
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function cellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return [...cell.getElementsByTagNameNS("*", "t")].map((node) => node.textContent || "").join("");
  }

  const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || "";
  if (type === "s") return sharedStrings[Number(value)] || "";
  return value;
}

function scheduleRowsFromTable(table) {
  const headerIndex = table.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes("resource") && normalized.includes("date") && normalized.includes("productdescription") && normalized.includes("unit");
  });

  if (headerIndex === -1) return [];

  const headers = table[headerIndex].map(normalizeHeader);
  const resourceIndex = headers.indexOf("resource");
  const dateIndex = headers.indexOf("date");
  const orderIndex = headers.indexOf("ordernumber");
  const productIndex = headers.indexOf("productdescription");
  const unitIndex = headers.indexOf("unit");
  let lastResource = "";

  return table
    .slice(headerIndex + 1)
    .map((row) => {
      const resource = String(row[resourceIndex] || lastResource || "").trim();
      if (row[resourceIndex]) lastResource = resource;

      const date = String(row[dateIndex] || "").trim();
      const order = String(row[orderIndex] || "").trim();
      const productDescription = String(row[productIndex] || "").trim();
      const planned = asNumber(row[unitIndex]);

      if (!resource || !date || !order || !productDescription || planned <= 0) return null;

      return {
        line: `${resource} | ${date}`,
        product: `${productDescription} | Order ${order}`,
        planned
      };
    })
    .filter(Boolean);
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scheduleKey(item) {
  const orderMatch = String(item.product || "").match(/\border\s+([a-z0-9-]+)/i);
  if (orderMatch) return `order:${normalizeKey(orderMatch[1])}`;
  return `${normalizeKey(item.line)}|${normalizeKey(item.product)}`;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function addItem({ line, product, planned }) {
  const item = {
    id: id(),
    line: line || "",
    product,
    planned: asNumber(planned),
    entries: [],
    archived: false
  };
  state.items.push(item);
  return item;
}

function importScheduleRows(rows, sourceLabel = "pasted schedule") {
  const importId = id();
  const incomingByKey = new Map();
  const changes = [];

  rows.forEach((row) => {
    const key = scheduleKey(row);
    const existing = incomingByKey.get(key);
    if (existing) {
      existing.planned += asNumber(row.planned);
      return;
    }
    incomingByKey.set(key, {
      line: row.line || "",
      product: row.product,
      planned: asNumber(row.planned)
    });
  });

  const incomingLineTypes = new Set([...incomingByKey.values()].map(lineTypeFor).filter(Boolean));
  const existingByKey = new Map(state.items.map((item) => [scheduleKey(item), item]));
  const result = {
    added: 0,
    revised: 0,
    restored: 0,
    removed: 0,
    unchanged: 0
  };

  incomingByKey.forEach((row, key) => {
    const existing = existingByKey.get(key);
    if (!existing) {
      const item = addItem(row);
      item.latestImportId = importId;
      result.added += 1;
      changes.push(changeRecord("added", item, null, item));
      return;
    }

    const previousPlanned = asNumber(existing.planned);
    const before = snapshotItem(existing);
    const wasArchived = Boolean(existing.archived);
    existing.line = row.line;
    existing.product = row.product;
    existing.planned = row.planned;
    existing.archived = false;
    existing.archivedAt = "";
    existing.latestImportId = importId;

    if (wasArchived) {
      result.restored += 1;
      changes.push(changeRecord("restored", existing, before, existing));
    } else if (previousPlanned !== row.planned || before.line !== existing.line || before.product !== existing.product) {
      result.revised += 1;
      changes.push(changeRecord("revised", existing, before, existing));
    } else {
      result.unchanged += 1;
      changes.push(changeRecord("unchanged", existing, before, existing));
    }
  });

  state.items.forEach((item) => {
    const itemLine = lineTypeFor(item);
    if (!incomingLineTypes.has(itemLine)) return;
    if (incomingByKey.has(scheduleKey(item))) return;
    if (item.archived) return;

    item.archived = true;
    item.archivedAt = new Date().toISOString();
    result.removed += 1;
    changes.push(changeRecord("removed", item, snapshotItem(item), item));
  });

  state.revisions ||= [];
  state.revisions.unshift({
    id: importId,
    at: new Date().toISOString(),
    source: sourceLabel,
    summary: result,
    changes
  });
  state.revisions = state.revisions.slice(0, 20);

  addLog(
    `Updated from ${sourceLabel}: ${result.added} added, ${result.revised} revised, ${result.restored} restored, ${result.removed} removed from latest, ${result.unchanged} unchanged.`
  );
}

function snapshotItem(item) {
  return {
    id: item.id,
    order: orderNumberFor(item),
    line: item.line || "",
    product: item.product || "",
    planned: asNumber(item.planned),
    made: madeFor(item),
    remaining: remainingFor(item),
    archived: Boolean(item.archived)
  };
}

function changeRecord(type, item, before, after) {
  return {
    type,
    order: orderNumberFor(item),
    product: stripOrder(item.product),
    before,
    after: after ? snapshotItem(after) : null
  };
}

function stripOrder(product) {
  return String(product || "").replace(/\s+\|\s+Order\s+[a-z0-9-]+$/i, "");
}

function render() {
  const activeItems = itemsForActiveLine();
  const currentItems = currentItemsForActiveLine();
  const planned = currentItems.reduce((total, item) => total + asNumber(item.planned), 0);
  const made = activeItems.reduce((total, item) => total + madeFor(item), 0);
  const remaining = currentItems.reduce((total, item) => total + remainingFor(item), 0);
  const shortLines = currentItems.filter((item) => remainingFor(item) > 0).length;

  els.plannedTotal.textContent = planned.toLocaleString();
  els.madeTotal.textContent = made.toLocaleString();
  els.remainingTotal.textContent = remaining.toLocaleString();
  els.shortLines.textContent = shortLines.toLocaleString();
  els.weekLabel.textContent = `Week of ${state.weekOf}`;
  els.lineFilter.value = activeLine;

  renderSchedule();
  renderOrderDetails();
  renderLog();
  renderChanges();
  updateAuthView();
  saveState();
}

function renderSchedule() {
  const rows = itemsForActiveLine().filter((item) => activeFilter === "all" || statusFor(item).key === activeFilter);
  const canManageSchedule = isAdmin();

  if (!rows.length) {
    els.scheduleBody.innerHTML = `<tr><td class="empty-state" colspan="7">No ${activeLine} schedule rows yet.</td></tr>`;
    return;
  }

  els.scheduleBody.innerHTML = rows
    .map((item) => {
      const made = madeFor(item);
      const remaining = remainingFor(item);
      const status = statusFor(item);
      return `
        <tr class="${item.archived ? "archived-row" : ""}">
          <td>${escapeHtml(item.line || "-")}</td>
          <td class="product-cell">${escapeHtml(item.product)}</td>
          <td class="number">${asNumber(item.planned).toLocaleString()}</td>
          <td class="number">${made.toLocaleString()}</td>
          <td class="number">${remaining.toLocaleString()}</td>
          <td><span class="status-pill status-${status.key}">${status.label}</span></td>
          <td>
            ${
              canManageSchedule
                ? `<div class="row-actions">
                    <button type="button" class="secondary-button" data-edit="${item.id}">Edit</button>
                    <button type="button" class="danger-button" data-delete="${item.id}">Delete</button>
                  </div>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderOrderDetails() {
  const orderNumber = els.orderInput.value.trim();
  if (!orderNumber) {
    els.orderDetails.innerHTML = "Order details will appear here.";
    return;
  }

  const item = findCurrentItemByOrder(orderNumber);
  if (!item) {
    els.orderDetails.innerHTML = `<strong>No current order found</strong>Check the order number or import the latest schedule.`;
    return;
  }

  const made = madeFor(item);
  const remaining = remainingFor(item);
  els.orderDetails.innerHTML = `
    <strong>${escapeHtml(item.product.replace(/\s+\|\s+Order\s+[a-z0-9-]+$/i, ""))}</strong>
    ${escapeHtml(item.line || "-")}
    <div class="detail-grid">
      <div><span>Order</span>${escapeHtml(orderNumberFor(item))}</div>
      <div><span>Planned</span>${asNumber(item.planned).toLocaleString()}</div>
      <div><span>Made</span>${made.toLocaleString()}</div>
      <div><span>Remaining</span>${remaining.toLocaleString()}</div>
    </div>
  `;
}

function renderLog() {
  if (!state.log.length) {
    els.auditLog.innerHTML = `<div class="empty-state">No production entries have been recorded yet.</div>`;
    return;
  }

  els.auditLog.innerHTML = state.log
    .map((entry) => {
      const date = new Date(entry.at);
      return `
        <article class="log-entry">
          <time datetime="${entry.at}">${date.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</time>
          <div>${escapeHtml(entry.message)}</div>
        </article>
      `;
    })
    .join("");
}

function renderChanges() {
  state.revisions ||= [];
  const latest = state.revisions[0];

  if (!latest) {
    els.changeSummaryLabel.textContent = "Latest upload";
    els.changeSummary.innerHTML = "";
    els.changeDetails.innerHTML = `<div class="empty-state">Upload a schedule to compare changes.</div>`;
    return;
  }

  const summary = latest.summary || {};
  const labels = [
    ["Added", summary.added || 0],
    ["Revised", summary.revised || 0],
    ["Restored", summary.restored || 0],
    ["Removed", summary.removed || 0],
    ["Unchanged", summary.unchanged || 0]
  ];
  els.changeSummaryLabel.textContent = `${latest.source || "Schedule"} - ${new Date(latest.at).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  })}`;
  els.changeSummary.innerHTML = labels
    .map(
      ([label, value]) => `
        <article>
          <span>${label}</span>
          <strong>${Number(value).toLocaleString()}</strong>
        </article>
      `
    )
    .join("");

  const visibleChanges = (latest.changes || []).filter((change) => change.type !== "unchanged").slice(0, 80);
  if (!visibleChanges.length) {
    els.changeDetails.innerHTML = `<div class="empty-state">No order-level changes in the latest upload.</div>`;
    return;
  }

  els.changeDetails.innerHTML = visibleChanges.map(renderChangeEntry).join("");
}

function renderChangeEntry(change) {
  const before = change.before || {};
  const after = change.after || {};
  const order = change.order || before.order || after.order || "-";
  const product = change.product || stripOrder(after.product || before.product || "");
  const detailLines = [];

  if (change.type === "revised") {
    if (before.planned !== after.planned) detailLines.push(`Planned: ${before.planned} -> ${after.planned}`);
    if (before.line !== after.line) detailLines.push(`Line/date: ${before.line || "-"} -> ${after.line || "-"}`);
    if (stripOrder(before.product) !== stripOrder(after.product)) {
      detailLines.push(`Product: ${stripOrder(before.product)} -> ${stripOrder(after.product)}`);
    }
  }

  if (change.type === "removed") detailLines.push(`Removed from latest schedule. Made so far: ${before.made || 0}.`);
  if (change.type === "added") detailLines.push(`New planned units: ${after.planned || 0}.`);
  if (change.type === "restored") detailLines.push(`Returned to latest schedule. Planned units: ${after.planned || 0}.`);

  return `
    <article class="change-entry">
      <span>${escapeHtml(change.type)}</span>
      <strong>Order ${escapeHtml(order)} - ${escapeHtml(product)}</strong>
      ${detailLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadCsv() {
  const header = ["Line", "Product", "Planned Units", "Made Units", "Remaining Units", "Status"];
  const rows = itemsForActiveLine().map((item) => {
    const status = statusFor(item);
    return [item.line, item.product, item.planned, madeFor(item), remainingFor(item), status.label];
  });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `batch-run-${activeLine.toLowerCase()}-${state.weekOf}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

els.scheduleCsv.addEventListener("change", () => {
  const file = els.scheduleCsv.files[0];
  if (!file) return;

  (async () => {
    const rows = await parseScheduleFile(file);
    if (!rows.length) {
      alert("No schedule rows were found in that file.");
      return;
    }
    importScheduleRows(rows, file.name);
    els.importText.value = "";
    els.scheduleCsv.value = "";
    render();
  })().catch((error) => {
    alert(error.message || "Unable to read that schedule file.");
    els.scheduleCsv.value = "";
  });
});

els.importRows.addEventListener("click", () => {
  const rows = parseSchedule(els.importText.value);
  if (!rows.length) {
    alert("No schedule rows were found. Try CSV like: Line,Product,Planned Units");
    return;
  }

  importScheduleRows(rows);
  els.importText.value = "";
  render();
});

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = signIn(els.loginName.value, els.loginPin.value);
  els.loginStatus.textContent = result.message;
  if (!result.ok) return;

  els.loginForm.reset();
  render();
});

els.orderInput.addEventListener("input", renderOrderDetails);

els.logoutButton.addEventListener("click", () => {
  const user = currentUser();
  if (user) addLog(`${user.name} signed out.`);
  state.currentUserId = "";
  render();
});

els.createUserForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = createBatcherAccount(els.newUserName.value, els.newUserPin.value);
  els.createUserStatus.textContent = result.message;
  if (!result.ok) return;

  els.createUserForm.reset();
  render();
});

els.activityTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedTab = button.dataset.activityTab;
    els.activityTabs.forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    els.auditPanel.classList.toggle("hidden", selectedTab !== "audit");
    els.changesPanel.classList.toggle("hidden", selectedTab !== "changes");
  });
});

els.productionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const user = currentUser();
  if (!user) {
    updateAuthView();
    return;
  }

  const item = findCurrentItemByOrder(els.orderInput.value);
  if (!item) {
    alert("Enter a current schedule order number before recording units.");
    return;
  }

  const units = asNumber(els.madeInput.value);
  const note = els.noteInput.value.trim();
  item.entries ||= [];
  item.entries.push({
    id: id(),
    at: new Date().toISOString(),
    batcher: user.name,
    userId: user.id,
    units,
    note
  });

  const remaining = remainingFor(item);
  const warning = remaining < 0 ? ` Warning: over planned by ${Math.abs(remaining)}.` : "";
  addLog(`${user.name} recorded ${units} units for ${item.product}.${note ? ` Note: ${note}.` : ""}${warning}`);
  els.madeInput.value = "";
  els.noteInput.value = "";
  render();
});

els.scheduleBody.addEventListener("click", (event) => {
  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;

  if ((editId || deleteId) && !isAdmin()) {
    alert("Only the master login can edit or delete schedule rows.");
    return;
  }

  if (editId) {
    const item = state.items.find((row) => row.id === editId);
    if (!item) return;
    const planned = prompt("Planned units", item.planned);
    if (planned === null) return;
    item.planned = Math.max(0, Math.round(asNumber(planned)));
    addLog(`Updated planned units for ${item.product} to ${item.planned}.`);
    render();
  }

  if (deleteId) {
    const item = state.items.find((row) => row.id === deleteId);
    if (!item || !confirm(`Delete ${item.product} from this schedule?`)) return;
    state.items = state.items.filter((row) => row.id !== deleteId);
    addLog(`Deleted schedule row for ${item.product}.`);
    render();
  }
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((node) => node.classList.toggle("active", node === button));
    render();
  });
});

els.lineFilter.addEventListener("change", () => {
  activeLine = els.lineFilter.value;
  state.activeLine = activeLine;
  render();
});

els.exportCsv.addEventListener("click", downloadCsv);

els.clearLog.addEventListener("click", () => {
  if (!isAdmin()) {
    alert("Only the master login can clear the audit log.");
    return;
  }
  if (!confirm("Clear the audit log for this browser?")) return;
  state.log = [];
  render();
});

els.clearWeek.addEventListener("click", () => {
  if (!confirm("Clear this week's schedule and log?")) return;
  state.items = [];
  state.log = [];
  state.weekOf = new Date().toISOString().slice(0, 10);
  state.activeLine = activeLine;
  render();
});

suppressSave = true;
render();
suppressSave = false;
loadSharedState();
if (SHARED_STATE_URL) {
  setInterval(loadSharedState, 5000);
}
