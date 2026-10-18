## 🎥 Project Demo

[▶️ Watch the Project Demo on YouTube](https://youtu.be/1p_BsG5Cwf0)


# Data Analytics Automated Report Narrative Generator

FastAPI + local LLM (Ollama) + React. All components are free/open-source.
Python computes every number; the LLM only writes the narrative; guardrails verify it.

## Run locally
**Backend**
```bash
cd backend && python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload          # docs: http://127.0.0.1:8000/docs
```
**LLM (optional)**: install Ollama, then `ollama pull qwen3:8b`. Without it the app uses a deterministic, verified template narrative.

**Frontend**
```bash
cd frontend && npm install && npm run dev      # http://localhost:5173
```
**Docker (all services)**: `docker compose up --build`, then `docker compose exec ollama ollama pull qwen3:8b`.

Model: **Qwen3 8B** (`qwen3:8b`, ~5 GB download, roughly 8 GB RAM/VRAM). Thinking mode is disabled for clean JSON output. On CPU-only machines raise `LLM_TIMEOUT` (default 120 s); the 1-minute target must be measured on your hardware.

## Interactive dashboard (Power BI-style)
- **Slicers** (left pane): category chips, date range, measure and aggregation (sum/mean/count/max)
- **Cross-filtering**: click any bar or pie slice and every visual, KPI, matrix and table updates; click again to clear
- **Drill-down**: click a month on the trend chart to filter to that month
- **Matrix heatmap**: click a cell to filter by both dimensions
- **Data tab**: sortable table with anomaly rows highlighted, export current view as CSV
- **AI Report tab**: narrates the *currently filtered view*, with numeric verification and guardrail results
- **Report builder**: executive/analyst audience, scope badge, stale-report warning, per-report history, generation timer
- **Live number verification**: every number in the narrative is green (matches computed evidence, hover for source) or red (no match); edit any section and it re-checks instantly
- **Evidence sidebar**: KPIs, trend sparkline, clickable category bars that jump to the dashboard filtered; export Markdown, copy, or print to PDF
- API: `POST /datasets/{id}/explore` (filters, date_from, date_to, metric, agg)

## Sample data
`sample_data/` has 600 synthetic sales rows in 8 formats (CSV, TSV, JSON, JSONL, XLSX, XML, Parquet, SQLite) with a planted Tablet decline from September and 2 outliers.
Regenerate: `python sample_data/generate_sample_data.py`

## Tests and evaluation
```bash
cd backend && pytest -q                 # all formats, exact totals, SSRF, SQL, numeric guard, PII
python evaluation/run_evaluation.py     # from repo root: accuracy + latency across formats
```
The 85% human-rated quality target needs a rubric and human reviewers; it is not computed automatically.

## API
`GET /api/v1/health` · `GET /api/v1/health/llm` · `POST /datasets/upload` · `POST /datasets/url` · `POST /datasets/sql` ·
`GET /datasets/{id}/profile` · `POST /reports/generate` · `GET /reports/{id}` · `/evaluation` · `/export`

SQL example (install a driver, e.g. `pip install psycopg2-binary`; use a read-only DB account):
`{"connection_string":"postgresql://ro_user:pw@host/db","query":"select * from sales"}`

## Guardrails implemented
Size/row limits, extension allow-list, SELECT-only SQL, SSRF block (private IPs, redirects, non-http), read-only SQLite,
regex PII scan (heuristic, not a guarantee), prompt-injection stripping of dataset strings, strict JSON schema from the LLM,
numeric-claim verification with retries then fallback to verified template.

## Not included (roadmap)
PDF tables/OCR, Presidio, Pandera, DeepEval, auth, persistent storage, and Phase 2/3 connectors (BigQuery, Snowflake, SharePoint, etc.)
need credentials/drivers; add each as a function in `connectors/registry.py` returning a DataFrame.
