import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, listCampaigns } from "./api.js";
import CampaignForm from "./CampaignForm.jsx";
import CampaignHistory from "./CampaignHistory.jsx";
import Analytics from "./Analytics.jsx";

const ACTIVE = new Set(["AWAITING_UPLOAD", "SENDING"]);

// Each tab has its own URL hash, so tabs can be bookmarked, opened in a new
// window, and navigated with the browser's back button.
const TABS = [
  { id: "new", label: "New campaign" },
  { id: "history", label: "History" },
  { id: "analytics", label: "Analytics" },
];
const tabFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === id) ? id : "new";
};

export default function App() {
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [highlight, setHighlight] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const timer = useRef(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id) => {
    if (id !== tab) window.location.hash = `/${id}`;
    window.scrollTo({ top: 0 });
  };

  // Arrow keys move between tabs (standard tablist keyboard pattern).
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    go(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

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

  const activeCount = campaigns.filter((c) => ACTIVE.has(c.status)).length;

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
            <span className="muted sender" title="Sender address">From {config.sender}</span>
          </div>
        )}
      </header>

      <nav className="tabbar" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <a
            key={t.id}
            id={`tab-${t.id}`}
            href={`#/${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tabbar-tab ${tab === t.id ? "on" : ""}`}
            onClick={(e) => { e.preventDefault(); go(t.id); }}
          >
            {t.label}
            {t.id === "history" && campaigns.length > 0 && (
              <span className={`count ${activeCount ? "count-live" : ""}`}>
                {activeCount ? `${activeCount} sending` : campaigns.length}
              </span>
            )}
          </a>
        ))}
      </nav>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel">
        {tab === "new" && (
          <div className="narrow">
            {config?.sandbox && (
              <div className="notice">
                Your SES account is in sandbox mode, so emails are delivered only to addresses verified in SES.
                Unverified recipients show up as failed.
              </div>
            )}
            <CampaignForm
              onSent={async (id) => {
                setHighlight(id);
                await refresh();
                go("history");
              }}
            />
          </div>
        )}

        {tab === "history" && (
          <CampaignHistory
            campaigns={campaigns}
            loading={loading}
            error={loadError}
            highlight={highlight}
            onRefresh={refresh}
            onNew={() => go("new")}
          />
        )}

        {tab === "analytics" && (
          loading ? (
            <section className="card"><p className="muted">Loading analytics...</p></section>
          ) : campaigns.length ? (
            <Analytics campaigns={campaigns} />
          ) : (
            <section className="card">
              <div className="empty">
                <strong>No data yet</strong>
                <span className="muted">Send your first campaign and its results will show up here.</span>
                <button type="button" className="ghost" onClick={() => go("new")}>Create a campaign</button>
              </div>
            </section>
          )
        )}
      </main>

      <footer className="footer">
        S3, Lambda, API Gateway, SES, DynamoDB, CloudWatch and SNS, deployed with Terraform
      </footer>
    </div>
  );
}
