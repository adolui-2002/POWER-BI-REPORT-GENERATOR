import { useState, useEffect, useMemo } from "react";
import ReportTab from "./ReportTab.jsx";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";
const COLORS = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const fmt = (n) => (n == null ? "–" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const post = async (path, opts) => { const r = await fetch(API + path, opts); const j = await r.json(); if (!r.ok) throw new Error(j.detail || "Request failed"); return j; };
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };

function Toggle({ value, options, onChange }) {
  return <span>{options.map((o) => <button key={o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>{o}</button>)}</span>;
}

function Breakdown({ col, data, selected, onToggle, metric }) {
  const [type, setType] = useState("bar");
  const dim = (n) => (selected.length && !selected.includes(n) ? 0.25 : 1);
  return (
    <div className="card">
      <h3>{metric} by {col}<Toggle value={type} options={["bar", "pie"]} onChange={setType} /></h3>
      <ResponsiveContainer height={230}>
        {type === "bar" ? (
          <BarChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis tickFormatter={fmt} fontSize={12} /><Tooltip formatter={fmt} />
            <Bar dataKey="value" cursor="pointer" onClick={(d) => onToggle(col, d.name)}>{data.map((d, i) => <Cell key={d.name} fill={COLORS[i % 8]} fillOpacity={dim(d.name)} />)}</Bar></BarChart>
        ) : (
          <PieChart><Tooltip formatter={fmt} /><Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} label={(d) => d.name} onClick={(d) => onToggle(col, d.name)} cursor="pointer">
            {data.map((d, i) => <Cell key={d.name} fill={COLORS[i % 8]} fillOpacity={dim(d.name)} />)}</Pie></PieChart>
        )}
      </ResponsiveContainer>
      <small style={{ color: "#6b7280" }}>Click a {type === "bar" ? "bar" : "slice"} to filter every visual (click again to clear).</small>
    </div>
  );
}

export default function App() {
  const [ds, setDs] = useState(null), [view, setView] = useState(null), [rep, setRep] = useState(null);
  const [filters, setFilters] = useState({}), [dateFrom, setDateFrom] = useState(""), [dateTo, setDateTo] = useState("");
  const [metric, setMetric] = useState(""), [agg, setAgg] = useState("sum"), [tab, setTab] = useState("Dashboard");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [url, setUrl] = useState(""), [useLlm, setUseLlm] = useState(true);
  const [mType, setMType] = useState("area"), [sort, setSort] = useState({ key: null, dir: 1 }), [over, setOver] = useState(false);

  const run = async (fn) => { setErr(""); setBusy(true); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  const load = (d) => {
    setDs(d); setRep(null); setFilters({}); setDateFrom(""); setDateTo(""); setTab("Dashboard");
    setMetric(d.schema.numeric.includes("revenue") ? "revenue" : d.schema.numeric[0]);
  };
  const upload = (file) => run(async () => { const fd = new FormData(); fd.append("file", file); load(await post("/datasets/upload", { method: "POST", body: fd })); });
  const fromUrl = () => run(async () => load(await post("/datasets/url", json({ url }))));

  useEffect(() => {
    if (!ds || !metric) return; let dead = false;
    post(`/datasets/${ds.dataset_id}/explore`, json({ filters, date_from: dateFrom || null, date_to: dateTo || null, metric, agg }))
      .then((v) => !dead && setView(v)).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [ds, filters, dateFrom, dateTo, metric, agg]);

  const toggle = (col, val) => setFilters((f) => {
    const cur = f[col] || [], nxt = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val], o = { ...f };
    nxt.length ? (o[col] = nxt) : delete o[col]; return o;
  });
  const clearAll = () => { setFilters({}); setDateFrom(""); setDateTo(""); };
  const drill = (m) => { setDateFrom(m + "-01"); setDateTo(monthEnd(m)); };
  const active = Object.entries(filters).flatMap(([c, v]) => v.map((x) => [c, x]));
  const hasFilter = active.length || dateFrom || dateTo;

  const generate = () => run(async () => {
    setRep(await post("/reports/generate", json({ dataset_id: ds.dataset_id, use_llm: useLlm, metric, filters, date_from: dateFrom || null, date_to: dateTo || null })));
  });
  const saveFile = (text, name, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
  const exportMd = async () => saveFile(await (await fetch(`${API}/reports/${rep.report_id}/export`)).text(), "report.md", "text/markdown");
  const exportCsv = () => {
    const cols = ds.quality.columns, rows = view.table;
    saveFile([cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n"), "view.csv", "text/csv");
  };

  const table = useMemo(() => {
    if (!view?.table) return [];
    const t = [...view.table]; if (sort.key) t.sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * sort.dir); return t;
  }, [view, sort]);

  const drop = (e) => { e.preventDefault(); setOver(false); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); };
  const K = view?.kpis || {}, mx = view?.matrix && Math.max(...view.matrix.cells.flat(), 1);

  return (
    <>
      <div className="top">
        <h1><b>▮▮</b> Narrative Studio</h1>
        {ds && <div className="tabs">{["Dashboard", "Data", "AI Report"].map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>}
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.jsonl,.ndjson,.xml,.parquet,.db,.sqlite" style={{ color: "#cbd5e1", marginLeft: ds ? 0 : "auto" }} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
      </div>
      {err && <div className="err" style={{ margin: 12 }}>{err}</div>}

      {!ds ? (
        <div className={"drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <h2>Drop a data file here</h2><p>CSV · TSV · Excel · JSON · JSONL · XML · Parquet · SQLite</p>
          <p>or load from a URL:</p>
          <input style={{ width: "70%", padding: 6 }} placeholder="https://…/data.csv" value={url} onChange={(e) => setUrl(e.target.value)} />{" "}
          <button className="btn" disabled={!url || busy} onClick={fromUrl}>Load</button>
          {busy && <p>Loading…</p>}
        </div>
      ) : (
        <div className="layout">
          <aside className="pane">
            <button className="btn ghost" disabled={!hasFilter} onClick={clearAll}>Clear all filters</button>
            <h4>Measure</h4>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>{ds.schema.numeric.map((c) => <option key={c}>{c}</option>)}</select>
            <select value={agg} onChange={(e) => setAgg(e.target.value)}>{["sum", "mean", "count", "max"].map((c) => <option key={c}>{c}</option>)}</select>
            {ds.schema.date_col && <><h4>Date range</h4>
              <input type="date" value={dateFrom} min={ds.schema.date_min} max={ds.schema.date_max} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" value={dateTo} min={ds.schema.date_min} max={ds.schema.date_max} onChange={(e) => setDateTo(e.target.value)} /></>}
            {Object.entries(ds.schema.categories).map(([c, vals]) => <div key={c}><h4>{c}</h4>
              {vals.map((v) => <span key={v} className={"chip" + ((filters[c] || []).includes(v) ? " on" : "")} onClick={() => toggle(c, v)}>{v}</span>)}</div>)}
            {ds.quality.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>)}
            {Object.keys(ds.pii).length > 0 && <p className="warn">⚠ Possible PII: {JSON.stringify(ds.pii)}</p>}
          </aside>

          <main className="canvas">
            {hasFilter ? <div className="pills">Filters:
              {active.map(([c, v]) => <span key={c + v} className="pill" onClick={() => toggle(c, v)}>{c}: {v} ✕</span>)}
              {(dateFrom || dateTo) && <span className="pill" onClick={() => { setDateFrom(""); setDateTo(""); }}>{dateFrom || "…"} → {dateTo || "…"} ✕</span>}
              <span style={{ color: "#6b7280" }}>{view?.rows}/{view?.total_rows} rows</span></div> : null}

            {tab === "Dashboard" && view && (view.rows === 0 ? <div className="card">No rows match the current filters.</div> : <>
              <div className="kpis">
                <div className="kpi"><small>Records</small><div>{fmt(K.count)}</div><span>{view.rows}/{view.total_rows} rows</span></div>
                <div className="kpi"><small>Total {metric}</small><div>{fmt(K.sum)}</div><span>{K.pct_of_total}% of dataset</span></div>
                <div className="kpi"><small>Average {metric}</small><div>{fmt(K.mean)}</div></div>
                <div className="kpi"><small>Max {metric}</small><div>{fmt(K.max)}</div></div>
                <div className="kpi"><small>Anomalies (|z|&gt;3)</small><div style={{ color: view.anomalies.length ? "#dc2626" : "inherit" }}>{view.anomalies.length}</div></div>
              </div>
              {view.monthly.length > 0 && <div className="card">
                <h3>{agg} of {metric} by month — click a point to drill down<Toggle value={mType} options={["area", "line", "bar"]} onChange={setMType} /></h3>
                <ResponsiveContainer height={250}>
                  {mType === "bar" ? <BarChart data={view.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={12} /><YAxis tickFormatter={fmt} fontSize={12} /><Tooltip formatter={fmt} />
                    <Bar dataKey="value" fill="#2563eb" cursor="pointer" onClick={(d) => drill(d.month)} /></BarChart>
                  : mType === "line" ? <LineChart data={view.monthly} onClick={(e) => e?.activeLabel && drill(e.activeLabel)}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={12} /><YAxis tickFormatter={fmt} fontSize={12} /><Tooltip formatter={fmt} /><Line dataKey="value" stroke="#2563eb" strokeWidth={2} /></LineChart>
                  : <AreaChart data={view.monthly} onClick={(e) => e?.activeLabel && drill(e.activeLabel)}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={12} /><YAxis tickFormatter={fmt} fontSize={12} /><Tooltip formatter={fmt} /><Area dataKey="value" stroke="#2563eb" fill="#bfdbfe" /></AreaChart>}
                </ResponsiveContainer>
              </div>}
              <div className="grid">
                {Object.entries(view.breakdowns).slice(0, 4).map(([c, d]) => d.length > 0 && <Breakdown key={c} col={c} data={d} selected={filters[c] || []} onToggle={toggle} metric={metric} />)}
              </div>
              {view.matrix && <div className="card"><h3>{view.matrix.row_col} × {view.matrix.col_col} (click a cell to filter)</h3>
                <div className="scroll"><table><thead><tr><th>{view.matrix.row_col}</th>{view.matrix.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{view.matrix.rows.map((r, i) => <tr key={r}><th>{r}</th>{view.matrix.cells[i].map((v, j) =>
                    <td key={j} className="cell" style={{ background: `rgba(37,99,235,${0.08 + 0.8 * v / mx})`, color: v / mx > 0.55 ? "#fff" : "inherit" }}
                      onClick={() => setFilters((f) => ({ ...f, [view.matrix.row_col]: [r], [view.matrix.col_col]: [view.matrix.cols[j]] }))}>{fmt(v)}</td>)}</tr>)}</tbody></table></div></div>}
              {view.anomalies.length > 0 && <div className="card"><h3>Anomalies in current view</h3>
                <ul className="clean">{view.anomalies.map((a) => <li key={a._row}>Row {a._row}: {metric} = {a.value} (z = {a.z}) — statistical outlier, cause unknown</li>)}</ul></div>}
            </>)}

            {tab === "Data" && view && <div className="card">
              <h3>Data ({view.rows} rows{view.rows > 1000 ? ", first 1000 shown" : ""}) — click a header to sort, red = anomaly
                <button className="btn ghost" onClick={exportCsv}>Export view CSV</button></h3>
              <div className="scroll"><table><thead><tr>{ds.quality.columns.map((c) => <th key={c} onClick={() => setSort((s) => ({ key: c, dir: s.key === c ? -s.dir : 1 }))}>{c}{sort.key === c ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>)}</tr></thead>
                <tbody>{table.map((r) => <tr key={r._row} className={r._anom ? "an" : ""}>{ds.quality.columns.map((c) => <td key={c}>{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table></div></div>}

            {tab === "AI Report" && <ReportTab post={post} json={json} API={API} datasetId={ds.dataset_id} rows={view?.rows ?? 0} useLlm={useLlm} setUseLlm={setUseLlm}
              scope={{ filters, date_from: dateFrom || null, date_to: dateTo || null, metric }}
              onDrill={(c, v) => { setFilters((f) => ({ ...f, [c]: [v] })); setTab("Dashboard"); }} />}
          </main>
        </div>
      )}
    </>
  );
}
