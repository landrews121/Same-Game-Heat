const STORAGE_KEY = "batch-run-tracker-v2";

const state = loadState();
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
  scheduleForm: document.querySelector("#scheduleForm"),
  lineInput: document.querySelector("#lineInput"),
  productInput: document.querySelector("#productInput"),
  plannedInput: document.querySelector("#plannedInput"),
  productionForm: document.querySelector("#productionForm"),
  batcherInput: document.querySelector("#batcherInput"),
  itemSelect: document.querySelector("#itemSelect"),
  lineFilter: document.querySelector("#lineFilter"),
  madeInput: document.querySelector("#madeInput"),
  noteInput: document.querySelector("#noteInput"),
  scheduleBody: document.querySelector("#scheduleBody"),
  auditLog: document.querySelector("#auditLog"),
  exportCsv: document.querySelector("#exportCsv"),
  clearWeek: document.querySelector("#clearWeek"),
  clearLog: document.querySelector("#clearLog")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.items) && Array.isArray(saved.log)) return saved;
  } catch {
    // Start clean if the browser has invalid saved data.
  }

  return {
    weekOf: new Date().toISOString().slice(0, 10),
    items: [],
    log: []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
      return;
    }

    const previousPlanned = asNumber(existing.planned);
    const wasArchived = Boolean(existing.archived);
    existing.line = row.line;
    existing.product = row.product;
    existing.planned = row.planned;
    existing.archived = false;
    existing.archivedAt = "";
    existing.latestImportId = importId;

    if (wasArchived) result.restored += 1;
    else if (previousPlanned !== row.planned) result.revised += 1;
    else result.unchanged += 1;
  });

  state.items.forEach((item) => {
    const itemLine = lineTypeFor(item);
    if (!incomingLineTypes.has(itemLine)) return;
    if (incomingByKey.has(scheduleKey(item))) return;
    if (item.archived) return;

    item.archived = true;
    item.archivedAt = new Date().toISOString();
    result.removed += 1;
  });

  addLog(
    `Updated from ${sourceLabel}: ${result.added} added, ${result.revised} revised, ${result.restored} restored, ${result.removed} removed from latest, ${result.unchanged} unchanged.`
  );
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
  renderSelect();
  renderLog();
  saveState();
}

function renderSchedule() {
  const rows = itemsForActiveLine().filter((item) => activeFilter === "all" || statusFor(item).key === activeFilter);

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
            <div class="row-actions">
              <button type="button" class="secondary-button" data-edit="${item.id}">Edit</button>
              <button type="button" class="danger-button" data-delete="${item.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderSelect() {
  const activeItems = currentItemsForActiveLine();

  if (!activeItems.length) {
    els.itemSelect.innerHTML = `<option value="">No current ${activeLine} rows available</option>`;
    els.itemSelect.disabled = true;
    return;
  }

  els.itemSelect.disabled = false;
  els.itemSelect.innerHTML = activeItems
    .map((item) => {
      const remaining = remainingFor(item);
      const label = `${item.line ? `${item.line} - ` : ""}${item.product} (${remaining} remaining)`;
      return `<option value="${item.id}">${escapeHtml(label)}</option>`;
    })
    .join("");
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

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    els.importText.value = reader.result;
    const rows = parseSchedule(reader.result);
    if (!rows.length) {
      alert("No schedule rows were found in that CSV.");
      return;
    }
    importScheduleRows(rows, file.name);
    els.importText.value = "";
    els.scheduleCsv.value = "";
    render();
  });
  reader.readAsText(file);
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

els.scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addItem({
    line: els.lineInput.value.trim(),
    product: els.productInput.value.trim(),
    planned: asNumber(els.plannedInput.value)
  });
  addLog(`Added ${els.productInput.value.trim()} with ${asNumber(els.plannedInput.value)} planned units.`);
  els.scheduleForm.reset();
  render();
});

els.productionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const item = state.items.find((row) => row.id === els.itemSelect.value);
  if (!item) return;

  const units = asNumber(els.madeInput.value);
  const batcher = els.batcherInput.value.trim();
  const note = els.noteInput.value.trim();
  item.entries ||= [];
  item.entries.push({
    id: id(),
    at: new Date().toISOString(),
    batcher,
    units,
    note
  });

  const remaining = remainingFor(item);
  const warning = remaining < 0 ? ` Warning: over planned by ${Math.abs(remaining)}.` : "";
  addLog(`${batcher} recorded ${units} units for ${item.product}.${note ? ` Note: ${note}.` : ""}${warning}`);
  els.madeInput.value = "";
  els.noteInput.value = "";
  render();
});

els.scheduleBody.addEventListener("click", (event) => {
  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;

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
  if (!confirm("Clear the audit log for this browser?")) return;
  state.log = [];
  render();
});

els.clearWeek.addEventListener("click", () => {
  if (!confirm("Clear this week's schedule, photo, and log?")) return;
  state.items = [];
  state.log = [];
  state.weekOf = new Date().toISOString().slice(0, 10);
  state.activeLine = activeLine;
  render();
});

render();
