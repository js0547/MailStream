// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), used to
// preview the recipient list before it is uploaded.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  text = text.replace(/^﻿/, "");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);

  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()]))
  );
  return { headers, records };
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function summarise({ headers, records }) {
  if (!headers.includes("email")) {
    return { error: "The CSV needs a header row with an 'email' column." };
  }
  const seen = new Set();
  let valid = 0, invalid = 0, duplicates = 0;
  for (const r of records) {
    const e = (r.email || "").toLowerCase();
    if (!e) continue;
    if (seen.has(e)) { duplicates++; continue; }
    seen.add(e);
    EMAIL_RE.test(e) ? valid++ : invalid++;
  }
  return { valid, invalid, duplicates, total: records.length };
}

export function renderTemplate(template, row = {}) {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => esc(row[key.toLowerCase()] ?? ""));
}
