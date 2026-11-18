import { useEffect, useState } from "react";
import { getCampaign } from "./api.js";

const STATUS = {
  AWAITING_UPLOAD: ["Queued", "chip-info"],
  SENDING: ["Sending", "chip-info"],
  COMPLETED: ["Completed", "chip-ok"],
  PARTIAL: ["Partial", "chip-warn"],
  FAILED: ["Failed", "chip-bad"],
};

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CampaignHistory({ campaigns, loading, error, highlight, onRefresh, onNew }) {
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (highlight) setOpen(highlight);
  }, [highlight]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Campaign history</h2>
        <button type="button" className="ghost" onClick={onRefresh}>Refresh</button>
      </div>

      {error && <div className="banner banner-bad">Could not load campaigns: {error}</div>}
      {loading && !error && <p className="muted">Loading...</p>}
      {!loading && !error && campaigns.length === 0 && (
        <div className="empty">
          <strong>No campaigns yet</strong>
          <span className="muted">Campaigns you send appear here with live progress.</span>
          {onNew && <button type="button" className="ghost" onClick={onNew}>Create a campaign</button>}
        </div>
      )}

      <ul className="campaigns">
        {campaigns.map((c) => (
          <CampaignRow
            key={c.campaign_id}
            campaign={c}
            open={open === c.campaign_id}
            onToggle={() => setOpen(open === c.campaign_id ? null : c.campaign_id)}
          />
        ))}
      </ul>
    </section>
  );
}

function CampaignRow({ campaign: c, open, onToggle }) {
  const [detail, setDetail] = useState(null);
  const [label, tone] = STATUS[c.status] || [c.status, "chip-info"];
  const done = (c.sent || 0) + (c.failed || 0) + (c.skipped || 0);
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;

  useEffect(() => {
    if (!open) return;
    getCampaign(c.campaign_id).then(setDetail).catch(() => setDetail(null));
  }, [open, c.campaign_id, c.status, c.sent, c.failed]);

  return (
    <li className={`campaign ${open ? "open" : ""}`}>
      <button type="button" className="campaign-row" onClick={onToggle} aria-expanded={open}>
        <div className="campaign-main">
          <span className="campaign-name">{c.name}</span>
          <span className="muted small">{formatTime(c.created_at)}</span>
        </div>
        <span className={`chip ${tone}`}>{label}</span>
      </button>

      <div className="progress" aria-label={`${pct}% processed`}>
        <span style={{ width: `${c.status === "AWAITING_UPLOAD" ? 4 : pct}%` }} className={c.failed ? "has-fail" : ""} />
      </div>
      <div className="counts small">
        <span><b>{c.sent || 0}</b> sent</span>
        <span><b className={c.failed ? "text-bad" : ""}>{c.failed || 0}</b> failed</span>
        {c.skipped ? <span><b>{c.skipped}</b> skipped</span> : null}
        <span className="muted">of {c.total || 0}</span>
      </div>

      {open && (
        <div className="detail">
          <div className="small"><span className="muted">Subject:</span> {c.subject}</div>
          <div className="small muted">ID {c.campaign_id}</div>
          {detail?.error && <div className="banner banner-bad">{detail.error}</div>}
          {detail?.results?.length ? (
            <table className="results">
              <thead><tr><th>Recipient</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {detail.results.map((r) => (
                  <tr key={r.email}>
                    <td>{r.email}</td>
                    <td><span className={`chip ${r.status === "SENT" ? "chip-ok" : r.status === "FAILED" ? "chip-bad" : "chip-warn"}`}>{r.status.toLowerCase()}</span></td>
                    <td className="muted">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">{c.status === "SENDING" || c.status === "AWAITING_UPLOAD" ? "Results appear when sending finishes." : "No per-recipient results."}</p>
          )}
        </div>
      )}
    </li>
  );
}
