import { useState, useEffect, useMemo, useRef } from "react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

const SECTIONS = [["executive_summary", "Executive summary"], ["findings", "Key findings"], ["anomaly_notes", "Anomalies"], ["recommendations", "Recommendations"], ["limitations", "Limitations"]];
const TOKEN = /(\d{4}-\d{2}(?:-\d{2})?|\d[\d,]*\.?\d*)/;
const fmt = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const toDraft = (n) => Object.fromEntries(SECTIONS.map(([k]) => [k, Array.isArray(n[k]) ? [...n[k]] : [String(n[k])]]));

function flatten(ev) {
  const out = []; const walk = (x, p) => {
    if (x && typeof x === "object") Object.entries(x).forEach(([k, v]) => walk(v, p ? `${p}.${k}` : k));
    else if (typeof x === "number") out.push({ n: Math.abs(x), p });
  }; walk(ev, ""); return out;
}
function check(tok, pool) {            // mirrors the server-side numeric guard
  if (/^\d{4}-\d{2}/.test(tok)) return null;
  const v = parseFloat(tok.replace(/,/g, "").replace(/\.$/, ""));
  if (isNaN(v) || v < 1 || [2024, 2025, 2026].includes(v)) return null;
  const hit = pool.find((e) => Math.abs(v - e.n) <= Math.max(0.01 * e.n, 0.51));
  return { ok: !!hit, src: hit?.p };
}
function Text({ text, pool }) {
  return text.split(TOKEN).map((t, i) => {
    if (i % 2 === 0) return t;
    const c = check(t, pool); if (!c) return t;
    return <mark key={i} className={c.ok ? "vok" : "vbad"} title={c.ok ? `Verified against evidence: ${c.src}` : "Not found in the analytics evidence"}>{t}</mark>;
  });
}
const label = (s) => {
  const p = Object.entries(s.filters).map(([c, v]) => `${c}: ${v.join("/")}`);
  if (s.date_from || s.date_to) p.push(`${s.date_from || "…"} → ${s.date_to || "…"}`);
  return `${p.join(" · ") || "Whole dataset"} · ${s.metric}`;
};

export default function ReportTab({ post, json, API, scope, rows, datasetId, useLlm, setUseLlm, onDrill }) {
  const [hist, setHist] = useState([]), [aid, setAid] = useState(null), [audience, setAudience] = useState("executive");
  const [busy, setBusy] = useState(false), [sec, setSec] = useState(0), [err, setErr] = useState("");
  const [edit, setEdit] = useState(null), [shut, setShut] = useState({}), [copied, setCopied] = useState("");
  const timer = useRef(); const key = JSON.stringify(scope);
  const cur = hist.find((h) => h.id === aid), stale = cur && cur.key !== key;
  useEffect(() => () => clearInterval(timer.current), []);

  const generate = async () => {
    setErr(""); setBusy(true); setSec(0); timer.current = setInterval(() => setSec((s) => s + 1), 1000);
    try {
      const rep = await post("/reports/generate", json({ dataset_id: datasetId, use_llm: useLlm, audience, ...scope }));
      const h = { id: rep.report_id, key, scope, audience, rep, orig: toDraft(rep.narrative), draft: toDraft(rep.narrative), label: label(scope), at: new Date().toLocaleTimeString() };
      setHist((x) => [h, ...x]); setAid(h.id); setEdit(null);
    } catch (e) { setErr(e.message); }
    clearInterval(timer.current); setBusy(false);
  };

  const pool = useMemo(() => (cur ? flatten(cur.rep.evidence) : []), [cur?.id]);
  const claims = useMemo(() => {
    let ok = 0, bad = 0; if (!cur) return { ok, bad };
    Object.values(cur.draft).flat().forEach((t) => t.split(TOKEN).forEach((x, i) => { if (i % 2) { const c = check(x, pool); if (c) c.ok ? ok++ : bad++; } }));
    return { ok, bad };
  }, [cur, pool]);
  const setDraft = (k, val) => setHist((hs) => hs.map((h) => (h.id === aid ? { ...h, draft: { ...h.draft, [k]: val } } : h)));

  const mdOf = (d) => [`# Data Analytics Report`, `_Scope: ${cur.label} · ${cur.rep.view.rows} rows · ${cur.audience} · ${claims.ok} numbers verified, ${claims.bad} unverified_`, "",
    ...SECTIONS.flatMap(([k, t]) => [`## ${t}`, ...(k === "executive_summary" ? d[k] : d[k].map((x) => `- ${x}`)), ""])].join("\n");
  const copy = (id, text) => { navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(""), 1500); };
  const save = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([mdOf(cur.draft)], { type: "text/markdown" })); a.download = "report.md"; a.click(); };

  const ev = cur?.rep.evidence;
  const monthly = ev?.monthly ? Object.entries(ev.monthly).map(([m, v]) => ({ m, v })) : [];
  const catKey = ev && Object.keys(ev.by_category).find((k) => !k.endsWith("_pct"));
  const cats = catKey ? Object.entries(ev.by_category[catKey]).map(([name, v]) => ({ name, v })) : [];
  const E = cur?.rep.evaluation;

  return (
    <div className="rep">
      <div className="card noprint">
        <h3>Report builder</h3>
        <div className="bar">
          <span className="seg">{["executive", "analyst"].map((a) => <button key={a} className={audience === a ? "on" : ""} onClick={() => setAudience(a)}>{a}</button>)}</span>
          <label><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> Local LLM (Qwen3)</label>
          <button className="btn" disabled={busy || !rows} onClick={generate}>{busy ? <><i className="spin" /> Generating… {sec}s</> : stale ? "↻ Regenerate for current view" : "Generate report"}</button>
        </div>
        <p className="scope">Scope: <b>{label(scope)}</b> · {rows} rows{!rows && <span className="warn"> — no rows match the filters</span>}</p>
        {err && <div className="err">{err}</div>}
        {hist.length > 0 && <div className="pills">History:{hist.map((h) => <span key={h.id} className={"chip" + (h.id === aid ? " on" : "")} onClick={() => { setAid(h.id); setEdit(null); }}>{h.at} · {h.audience} · {h.label}</span>)}</div>}
      </div>

      {stale && <div className="stale noprint">⚠ This report was generated for a different view: <b>{cur.label}</b>. Your current filters changed. <button className="btn" disabled={busy || !rows} onClick={generate}>Regenerate</button></div>}

      {cur && <div className="rgrid">
        <div>
          {SECTIONS.map(([k, title]) => {
            const items = cur.draft[k], edited = JSON.stringify(items) !== JSON.stringify(cur.orig[k]);
            return (
              <div className="card sec" key={k}>
                <h3><span style={{ cursor: "pointer" }} onClick={() => setShut((s) => ({ ...s, [k]: !s[k] }))}>{shut[k] ? "▸" : "▾"} {title}{edited && <em className="badge">edited</em>}</span>
                  <span className="noprint">
                    <button onClick={() => setEdit(edit === k ? null : k)}>{edit === k ? "Done" : "✎ Edit"}</button>
                    {edited && <button onClick={() => setDraft(k, cur.orig[k])}>Reset</button>}
                    <button onClick={() => copy(k, items.join("\n"))}>{copied === k ? "Copied ✓" : "Copy"}</button></span></h3>
                {!shut[k] && (edit === k
                  ? <textarea rows={Math.max(3, items.length + 1)} value={items.join("\n")} onChange={(e) => setDraft(k, e.target.value.split("\n").filter(Boolean))} />
                  : k === "executive_summary" ? <p className="lead"><Text text={items[0] || ""} pool={pool} /></p>
                  : <ul className="clean">{items.map((x, i) => <li key={i}><Text text={x} pool={pool} /></li>)}</ul>)}
              </div>);
          })}
          <div className="bar noprint">
            <button className="btn" onClick={save}>Download Markdown</button>
            <button className="btn ghost" onClick={() => copy("all", mdOf(cur.draft))}>{copied === "all" ? "Copied ✓" : "Copy all"}</button>
            <button className="btn ghost" onClick={() => window.print()}>Print / PDF</button>
          </div>
        </div>

        <aside>
          <div className="card">
            <h3>Verification</h3>
            <p><span className="vok">{claims.ok} verified</span> <span className={claims.bad ? "vbad" : ""}>{claims.bad} unverified</span></p>
            <small>Green numbers match the Python-computed evidence (hover to see which). Edit text and the check re-runs live; red means no matching evidence.</small>
            <p>Server check: <b style={{ color: E.numeric_check.ok ? "green" : "red" }}>{E.numeric_check.ok ? "PASSED" : "FAILED"}</b> · {E.latency_s}s · {E.narrative_source}</p>
            <p>Sections: {String(E.sections_present)} · PII: {String(E.pii_detected)} · {cur.rep.view.rows} rows analysed</p>
          </div>
          <div className="card"><h3>Evidence: {ev.metric}</h3>
            <p>Total <b>{fmt(ev.total)}</b> · Avg <b>{fmt(ev.average)}</b> · Median <b>{fmt(ev.median)}</b></p>
            {monthly.length > 1 && <ResponsiveContainer height={90}><AreaChart data={monthly}><XAxis dataKey="m" hide /><YAxis hide /><Tooltip formatter={fmt} /><Area dataKey="v" stroke="#2563eb" fill="#bfdbfe" /></AreaChart></ResponsiveContainer>}
            {cats.length > 0 && <><small>By {catKey} — click a bar to explore it in the dashboard</small>
              <ResponsiveContainer height={110}><BarChart data={cats}><XAxis dataKey="name" fontSize={11} /><YAxis hide /><Tooltip formatter={fmt} />
                <Bar dataKey="v" cursor="pointer" onClick={(d) => onDrill(catKey, d.name)}>{cats.map((c) => <Cell key={c.name} fill="#2563eb" />)}</Bar></BarChart></ResponsiveContainer></>}
            {ev.anomalies.length > 0 && <><small>Anomalies (statistical outliers, cause unknown)</small><ul className="clean">{ev.anomalies.slice(0, 5).map((a) => <li key={a.row}>Row {a.row}: {a.value} (z = {a.z_score})</li>)}</ul></>}
          </div>
        </aside>
      </div>}
    </div>
  );
}
