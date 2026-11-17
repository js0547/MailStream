import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, listCampaigns } from "./api.js";
import CampaignForm from "./CampaignForm.jsx";
import CampaignHistory from "./CampaignHistory.jsx";

const ACTIVE = new Set(["AWAITING_UPLOAD", "SENDING"]);

export default function App() {
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [highlight, setHighlight] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listCampaigns();
      setCampaigns(list);
      setLoadError("");
      return list;
    } catch (e) {
      setLoadError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
    refresh();
  }, [refresh]);

  // Poll every 3 s while any campaign is still being sent.
  useEffect(() => {
    clearTimeout(timer.current);
    if (campaigns.some((c) => ACTIVE.has(c.status))) {
      timer.current = setTimeout(refresh, 3000);
    }
    return () => clearTimeout(timer.current);
  }, [campaigns, refresh]);

  const totals = campaigns.reduce(
    (acc, c) => ({ sent: acc.sent + (c.sent || 0), failed: acc.failed + (c.failed || 0) }),
    { sent: 0, failed: 0 }
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
          </span>
          <div>
            <h1>MailStream</h1>
            <p>Serverless bulk email on AWS</p>
          </div>
        </div>
        {config && (
          <div className="ses-status">
            <span className={`chip ${config.sandbox ? "chip-warn" : "chip-ok"}`}>
              {config.sandbox ? "SES sandbox" : "SES production"}
            </span>
            <span className="muted">
              {Math.round(config.sent_24h ?? 0)} / {Math.round(config.max_24h ?? 0)} sent today
            </span>
          </div>
        )}
      </header>

      <section className="stats" aria-label="Summary">
        <Stat label="Campaigns" value={campaigns.length} />
        <Stat label="Emails sent" value={totals.sent} />
        <Stat label="Failed" value={totals.failed} tone={totals.failed ? "bad" : undefined} />
        <Stat label="Sender" value={config?.sender ?? "..."} small />
      </section>

      {config?.sandbox && (
        <div className="notice">
          Your SES account is in sandbox mode, so emails are delivered only to addresses verified in SES.
          Unverified recipients show up as failed.
        </div>
      )}

      <main className="grid">
        <CampaignForm
          onSent={async (id) => {
            setHighlight(id);
            await refresh();
          }}
        />
        <CampaignHistory
          campaigns={campaigns}
          loading={loading}
          error={loadError}
          highlight={highlight}
          onRefresh={refresh}
        />
      </main>

      <footer className="footer">
        S3, Lambda, API Gateway, SES, DynamoDB, CloudWatch, SNS and CloudFront, deployed with Terraform
      </footer>
    </div>
  );
}

function Stat({ label, value, tone, small }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${small ? "stat-small" : ""} ${tone === "bad" ? "text-bad" : ""}`}>{value}</span>
    </div>
  );
}
