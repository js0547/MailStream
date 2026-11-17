import { useMemo, useRef, useState } from "react";
import { createAndUpload } from "./api.js";
import { parseCsv, renderTemplate, summarise } from "./csv.js";
import { SAMPLE_CSV, STARTER_TEMPLATES } from "./templates.js";

export default function CampaignForm({ onSent }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(STARTER_TEMPLATES[0].subject);
  const [template, setTemplate] = useState(STARTER_TEMPLATES[0].html);
  const [tab, setTab] = useState("preview");
  const [csvFile, setCsvFile] = useState(null);
  const [csv, setCsv] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState({});
  const fileInput = useRef(null);

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
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const id = await createAndUpload({ name: name.trim(), subject: subject.trim(), template, csvFile });
      setMessage({ tone: "ok", text: `Campaign queued. Sending to ${summary.valid} recipient(s) now.` });
      setName("");
      setCsv(null);
      setCsvFile(null);
      if (fileInput.current) fileInput.current.value = "";
      onSent(id);
    } catch (err) {
      setMessage({ tone: "bad", text: err.message });
    } finally {
      setBusy(false);
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

      {message && <div className={`banner ${message.tone === "ok" ? "banner-ok" : "banner-bad"}`}>{message.text}</div>}

      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Uploading..." : summary?.valid ? `Send to ${summary.valid} recipient${summary.valid === 1 ? "" : "s"}` : "Send campaign"}
      </button>
    </form>
  );
}
