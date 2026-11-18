import { useMemo, useRef, useState } from "react";
import { createAndUpload } from "./api.js";
import { parseCsv, renderTemplate, summarise } from "./csv.js";
import { SAMPLE_CSV, STARTER_TEMPLATES } from "./templates.js";

const ATTACH_TYPES = /\.(pdf|png|jpe?g)$/i;
const MAX_FILES = 5;
const MAX_TOTAL = 7 * 1024 * 1024;

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The sender Lambda stores files under a sanitised name; mirror it so the
// names shown here match the names to use in the CSV `attachment` column.
const safeName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);

export default function CampaignForm({ onSent }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(STARTER_TEMPLATES[0].subject);
  const [template, setTemplate] = useState(STARTER_TEMPLATES[0].html);
  const [tab, setTab] = useState("preview");
  const [csvFile, setCsvFile] = useState(null);
  const [csv, setCsv] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);
  const attachInput = useRef(null);

  const totalSize = files.reduce((n, f) => n + f.size, 0);
  const perRecipient = files.length > 0 && csv?.headers?.includes("attachment");
  const missingAttachments = useMemo(() => {
    if (!perRecipient) return [];
    const have = new Set(files.map((f) => safeName(f.name).toLowerCase()));
    const missing = new Set();
    for (const r of csv.records) {
      for (const n of (r.attachment || "").split(";").map((s) => s.trim()).filter(Boolean)) {
        if (!have.has(safeName(n.split(/[\\/]/).pop()).toLowerCase())) missing.add(n);
      }
    }
    return [...missing];
  }, [perRecipient, files, csv]);

  function addFiles(list) {
    const picked = [...list];
    const bad = picked.find((f) => !ATTACH_TYPES.test(f.name));
    if (bad) {
      setErrors((e) => ({ ...e, files: `${bad.name}: only PDF, PNG and JPG files can be attached.` }));
      return;
    }
    const byName = new Map(files.map((f) => [safeName(f.name).toLowerCase(), f]));
    for (const f of picked) byName.set(safeName(f.name).toLowerCase(), f);
    const next = [...byName.values()];
    if (next.length > MAX_FILES) {
      setErrors((e) => ({ ...e, files: `You can attach at most ${MAX_FILES} files.` }));
      return;
    }
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) {
      setErrors((e) => ({ ...e, files: "Attachments must be 7 MB or smaller in total (SES limit)." }));
      return;
    }
    setFiles(next);
    setErrors((e) => ({ ...e, files: undefined }));
  }

  function removeFile(name) {
    setFiles((fs) => fs.filter((f) => f.name !== name));
  }

  const summary = useMemo(() => (csv ? summarise(csv) : null), [csv]);
  const previewRow = csv?.records?.[0] || { name: "Alex", email: "alex@example.com", status: "Shortlisted" };
  const previewHtml = useMemo(() => renderTemplate(template, previewRow), [template, previewRow]);
  const previewSubject = renderTemplate(subject, previewRow).replace(/&amp;/g, "&");

  async function loadFile(file) {
    if (!file) return;
    setMessage(null);
    if (!/\.csv$/i.test(file.name)) {
      setErrors((e) => ({ ...e, csv: "Choose a .csv file." }));
      return;
    }
    if (file.size > 1_000_000) {
      setErrors((e) => ({ ...e, csv: "CSV must be smaller than 1 MB." }));
      return;
    }
    const parsed = parseCsv(await file.text());
    setCsvFile(file);
    setCsv(parsed);
    setErrors((e) => ({ ...e, csv: undefined }));
  }

  function pickTemplate(id) {
    const t = STARTER_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplate(t.html);
    setSubject(t.subject);
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "recipients-sample.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  function validate() {
    const next = {};
    if (!name.trim()) next.name = "Give the campaign a name.";
    if (!subject.trim()) next.subject = "Enter a subject line.";
    if (!template.trim()) next.template = "The template can't be empty.";
    if (!csvFile) next.csv = "Upload a recipients CSV.";
    else if (summary?.error) next.csv = summary.error;
    else if (!summary?.valid) next.csv = "The CSV has no valid email addresses.";
    if (missingAttachments.length) next.files = `The CSV names files you haven't attached: ${missingAttachments.join(", ")}`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const id = await createAndUpload(
        { name: name.trim(), subject: subject.trim(), template, csvFile, attachments: files },
        setProgress
      );
      const withFiles = files.length ? ` with ${files.length} attachment${files.length === 1 ? "" : "s"}` : "";
      setMessage({ tone: "ok", text: `Campaign queued. Sending to ${summary.valid} recipient(s)${withFiles} now.` });
      setName("");
      setCsv(null);
      setCsvFile(null);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      if (attachInput.current) attachInput.current.value = "";
      onSent(id);
    } catch (err) {
      setMessage({ tone: "bad", text: err.message });
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>New campaign</h2>
      </div>

      <div className="field">
        <label htmlFor="name">Campaign name</label>
        <input id="name" value={name} maxLength={100} placeholder="e.g. Orientation invite 2026"
          onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />
        {errors.name && <span className="error">{errors.name}</span>}
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="csv">Recipients CSV</label>
          <button type="button" className="link" onClick={downloadSample}>Download sample</button>
        </div>
        <div
          className={`drop ${dragging ? "drop-active" : ""} ${errors.csv ? "drop-error" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files[0]); }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        >
          <input id="csv" ref={fileInput} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => loadFile(e.target.files[0])} />
          {csvFile ? (
            <>
              <strong>{csvFile.name}</strong>
              {summary && !summary.error && (
                <span className="muted">
                  {summary.valid} valid
                  {summary.invalid ? `, ${summary.invalid} invalid` : ""}
                  {summary.duplicates ? `, ${summary.duplicates} duplicate` : ""}
                  {" · columns: "}{csv.headers.join(", ")}
                </span>
              )}
            </>
          ) : (
            <>
              <strong>Drop a CSV here or click to browse</strong>
              <span className="muted">Needs an <code>email</code> column. Other columns like <code>name</code> become placeholders.</span>
            </>
          )}
        </div>
        {errors.csv && <span className="error">{errors.csv}</span>}
      </div>

      <div className="field">
        <label htmlFor="subject">Subject</label>
        <input id="subject" value={subject} maxLength={200}
          onChange={(e) => { setSubject(e.target.value); setErrors((x) => ({ ...x, subject: undefined })); }} />
        {errors.subject && <span className="error">{errors.subject}</span>}
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="starter">Email template</label>
          <select id="starter" defaultValue="welcome" onChange={(e) => pickTemplate(e.target.value)}>
            {STARTER_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "tab on" : "tab"} onClick={() => setTab("preview")}>Preview</button>
          <button type="button" role="tab" aria-selected={tab === "html"} className={tab === "html" ? "tab on" : "tab"} onClick={() => setTab("html")}>HTML</button>
        </div>
        {tab === "html" ? (
          <textarea className="code" value={template} spellCheck={false}
            onChange={(e) => { setTemplate(e.target.value); setErrors((x) => ({ ...x, template: undefined })); }} />
        ) : (
          <div className="preview">
            <div className="preview-meta">
              <span className="muted">To:</span> {previewRow.email || "-"}
              <br /><span className="muted">Subject:</span> {previewSubject}
            </div>
            <iframe title="Email preview" sandbox="" srcDoc={previewHtml} />
          </div>
        )}
        <span className="hint">Use <code>{"{{name}}"}</code>, <code>{"{{email}}"}</code> or any CSV column as a placeholder. The preview uses the first CSV row.</span>
        {errors.template && <span className="error">{errors.template}</span>}
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="attach">Attachments <span className="muted optional">optional</span></label>
          {files.length > 0 && <span className="muted small">{formatSize(totalSize)} of 7 MB</span>}
        </div>
        <input id="attach" ref={attachInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        {files.length > 0 && (
          <ul className="files">
            {files.map((f) => (
              <li key={f.name}>
                <span className="file-ext">{f.name.split(".").pop().toUpperCase()}</span>
                <span className="file-name" title={f.name}>{f.name}</span>
                <span className="muted small">{formatSize(f.size)}</span>
                <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.name)}>×</button>
              </li>
            ))}
          </ul>
        )}
        {files.length < MAX_FILES && (
          <button type="button" className="ghost attach-btn" onClick={() => attachInput.current?.click()}>
            + Add PDF or image
          </button>
        )}
        <span className="hint">
          {perRecipient
            ? <>Your CSV has an <code>attachment</code> column, so each person gets only the file named in their row.</>
            : <>Every recipient gets all attached files. To send each person their own file (like offer letters), add an <code>attachment</code> column with the file name.</>}
        </span>
        {errors.files && <span className="error">{errors.files}</span>}
      </div>

      {message && <div className={`banner ${message.tone === "ok" ? "banner-ok" : "banner-bad"}`}>{message.text}</div>}

      <button className="primary" type="submit" disabled={busy}>
        {busy ? progress || "Uploading..." : summary?.valid ? `Send to ${summary.valid} recipient${summary.valid === 1 ? "" : "s"}` : "Send campaign"}
      </button>
    </form>
  );
}
