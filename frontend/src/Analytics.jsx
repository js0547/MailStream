import { useMemo, useState } from "react";

// Status colours (fixed, never reused for anything else). Each is always
// paired with a text label so meaning never relies on colour alone.
const OUTCOMES = [
  { key: "sent", label: "Sent", color: "#0ca30c" },
  { key: "failed", label: "Failed", color: "#d03b3b" },
  { key: "skipped", label: "Skipped", color: "#fab219" },
];

const DAYS = 14;
const MAX_CAMPAIGNS = 8;

const n = (v) => Number(v) || 0;
const fmt = (v) => v.toLocaleString();
const dayKey = (d) => d.toISOString().slice(0, 10);

export default function Analytics({ campaigns }) {
  const [showTable, setShowTable] = useState(false);
  const [tip, setTip] = useState(null);

  const data = useMemo(() => {
    const totals = { sent: 0, failed: 0, skipped: 0 };
    for (const c of campaigns) for (const o of OUTCOMES) totals[o.key] += n(c[o.key]);
    const attempted = totals.sent + totals.failed;

    const recent = campaigns.slice(0, MAX_CAMPAIGNS).map((c) => ({
      id: c.campaign_id,
      name: c.name,
      sent: n(c.sent),
      failed: n(c.failed),
      skipped: n(c.skipped),
    }));

    // Emails delivered per day for the last 14 days (local time).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({ key: dayKey(d), date: d, sent: 0 });
    }
    const index = Object.fromEntries(days.map((d, i) => [d.key, i]));
    for (const c of campaigns) {
      if (!c.created_at) continue;
      const d = new Date(c.created_at);
      d.setHours(0, 0, 0, 0);
      const i = index[dayKey(d)];
      if (i !== undefined) days[i].sent += n(c.sent);
    }

    return {
      totals,
      rate: attempted ? Math.round((totals.sent / attempted) * 1000) / 10 : null,
      recent,
      days,
    };
  }, [campaigns]);

  if (campaigns.length === 0) return null;

  return (
    <section className="card analytics" aria-labelledby="analytics-title">
      <div className="card-head">
        <h2 id="analytics-title">Analytics</h2>
        <button type="button" className="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? "Show charts" : "Show table"}
        </button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-value">{data.rate === null ? "–" : `${data.rate}%`}</span>
          <span className="kpi-label">Delivery rate</span>
          <span className="muted small">sent ÷ (sent + failed)</span>
        </div>
        {OUTCOMES.map((o) => (
          <div className="kpi" key={o.key}>
            <span className="kpi-value">{fmt(data.totals[o.key])}</span>
            <span className="kpi-label"><span className="swatch" style={{ background: o.color }} aria-hidden="true" />{o.label}</span>
          </div>
        ))}
      </div>

      {showTable ? (
        <AnalyticsTable recent={data.recent} days={data.days} />
      ) : (
        <div className="charts" onMouseLeave={() => setTip(null)}>
          <CampaignBars recent={data.recent} setTip={setTip} />
          <DailyColumns days={data.days} setTip={setTip} />
          {tip && (
            <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
              <strong>{tip.title}</strong>
              {tip.rows.map((r) => (
                <div key={r.label} className="tooltip-row">
                  {r.color && <span className="swatch" style={{ background: r.color }} aria-hidden="true" />}
                  <span>{r.label}</span>
                  <b>{fmt(r.value)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Position a tooltip relative to the .charts container.
function tipAt(e, title, rows) {
  const box = e.currentTarget.closest(".charts").getBoundingClientRect();
  return { x: e.clientX - box.left + 12, y: e.clientY - box.top + 12, title, rows };
}

function CampaignBars({ recent, setTip }) {
  const rowH = 32, labelW = 118, barMax = 200, gap = 2;
  const max = Math.max(1, ...recent.map((c) => c.sent + c.failed + c.skipped));
  const height = recent.length * rowH + 8;

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">Results per campaign</span>
        <span className="legend">
          {OUTCOMES.map((o) => (
            <span key={o.key}><span className="swatch" style={{ background: o.color }} aria-hidden="true" />{o.label}</span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${labelW + barMax + 50} ${height}`} role="img"
        aria-label="Stacked bars of sent, failed and skipped emails for recent campaigns">
        {recent.map((c, i) => {
          const y = i * rowH + 6;
          const total = c.sent + c.failed + c.skipped;
          let x = labelW;
          const segs = OUTCOMES.filter((o) => c[o.key] > 0).map((o) => {
            const w = Math.max(3, (c[o.key] / max) * barMax);
            const seg = { ...o, x, w, value: c[o.key] };
            x += w + gap;
            return seg;
          });
          const rows = OUTCOMES.map((o) => ({ label: o.label, value: c[o.key], color: o.color }));
          return (
            <g key={c.id} className="bar-row"
              onMouseMove={(e) => setTip(tipAt(e, c.name, rows))}
              onMouseLeave={() => setTip(null)}>
              <rect x="0" y={y - 3} width={labelW + barMax + 50} height={rowH - 2} className="hit" />
              <text x={labelW - 10} y={y + 12} textAnchor="end" className="axis-label">
                {c.name.length > 15 ? c.name.slice(0, 14) + "…" : c.name}
              </text>
              {segs.map((s, j) => (
                <rect key={s.key} x={s.x} y={y} width={s.w} height={20} fill={s.color}
                  rx={j === segs.length - 1 ? 4 : 0} />
              ))}
              {segs.length === 0 && <rect x={labelW} y={y} width={3} height={20} className="empty-bar" />}
              <text x={x + 6} y={y + 14} className="value-label">{fmt(total)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function DailyColumns({ days, setTip }) {
  const W = 360, H = 170, left = 28, bottom = 22, top = 18;
  const plotH = H - bottom - top;
  const max = Math.max(...days.map((d) => d.sent));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const slot = (W - left) / days.length;
  const barW = Math.min(16, slot - 6);
  const ticks = [0, niceMax / 2, niceMax];
  const peak = max > 0 ? days.reduce((a, b) => (b.sent > a.sent ? b : a)) : null;

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">Emails sent per day</span>
        <span className="muted small">last {DAYS} days</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Column chart of emails sent per day over the last ${DAYS} days`}>
        {ticks.map((t) => {
          const y = top + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={W} y1={y} y2={y} className={t === 0 ? "baseline" : "gridline"} />
              <text x={left - 6} y={y + 4} textAnchor="end" className="axis-label">{fmt(t)}</text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const h = (d.sent / niceMax) * plotH;
          const x = left + i * slot + (slot - barW) / 2;
          const y = top + plotH - h;
          const label = d.date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
          return (
            <g key={d.key}
              onMouseMove={(e) => setTip(tipAt(e, label, [{ label: "Sent", value: d.sent }]))}
              onMouseLeave={() => setTip(null)}>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} className="hit" />
              {d.sent > 0 && <path d={roundedTop(x, y, barW, h)} className="column" />}
              {(i % 2 === (days.length - 1) % 2) && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="axis-label">
                  {d.date.getDate()}
                </text>
              )}
              {peak === d && <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="value-label">{fmt(d.sent)}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// Column with 4px rounded top corners and a square base on the axis.
function roundedTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function AnalyticsTable({ recent, days }) {
  return (
    <div className="table-views">
      <table className="results">
        <caption className="chart-title">Results per campaign</caption>
        <thead><tr><th>Campaign</th>{OUTCOMES.map((o) => <th key={o.key}>{o.label}</th>)}</tr></thead>
        <tbody>
          {recent.map((c) => (
            <tr key={c.id}><td>{c.name}</td>{OUTCOMES.map((o) => <td key={o.key}>{fmt(c[o.key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <table className="results">
        <caption className="chart-title">Emails sent per day</caption>
        <thead><tr><th>Date</th><th>Sent</th></tr></thead>
        <tbody>
          {days.filter((d) => d.sent > 0).map((d) => (
            <tr key={d.key}><td>{d.date.toLocaleDateString()}</td><td>{fmt(d.sent)}</td></tr>
          ))}
          {days.every((d) => d.sent === 0) && <tr><td colSpan={2} className="muted">No emails sent in the last {DAYS} days.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
