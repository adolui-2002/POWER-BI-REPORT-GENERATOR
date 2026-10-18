import uuid
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from app.config import ORIGINS, MAX_UPLOAD_MB
from app.connectors import registry
from app.services import preprocessing, guardrails, report, llm_service, explore

app = FastAPI(title="Data Analytics Narrative Generator", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
DATASETS: dict = {}   # in-memory; swap for SQLite for persistence
REPORTS: dict = {}

def _register(df):
    df, q = preprocessing.clean(df)
    pii = guardrails.scan_pii(df)
    did = uuid.uuid4().hex[:12]
    DATASETS[did] = {"df": df, "quality": q, "pii": pii}
    return {"dataset_id": did, "quality": q, "pii": pii, "schema": explore.schema(df), "preview": df.head(10).astype(str).to_dict("records")}

def _guard(fn):
    try: return fn()
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"{type(e).__name__}: {e}")

def _get(store, key, label):
    if key not in store: raise HTTPException(404, f"Unknown {label}")
    return store[key]

@app.get("/api/v1/health")
def health(): return {"status": "healthy"}

@app.get("/api/v1/health/llm")
def llm_health(): return {"provider": "ollama", "status": "up" if llm_service.llm_ok() else "down (template fallback active)"}

@app.post("/api/v1/datasets/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024: raise HTTPException(413, "File too large")
    if not data: raise HTTPException(400, "Empty file")
    name = file.filename or ""
    if name.lower().endswith((".db", ".sqlite")):
        return _guard(lambda: _register(registry.load_sqlite(data)))
    return _guard(lambda: _register(registry.load_file(name, data)))

class UrlReq(BaseModel): url: str
class SqlReq(BaseModel): connection_string: str; query: str
class GenReq(BaseModel):
    dataset_id: str; use_llm: bool = True; metric: str | None = None; audience: str = "executive"
    filters: dict[str, list[str]] = {}; date_from: str | None = None; date_to: str | None = None

class ExploreReq(BaseModel):
    filters: dict[str, list[str]] = {}; date_from: str | None = None; date_to: str | None = None
    metric: str | None = None; agg: str = "sum"


@app.post("/api/v1/datasets/url")
def from_url(r: UrlReq): return _guard(lambda: _register(registry.load_url(r.url)))

@app.post("/api/v1/datasets/sql")
def from_sql(r: SqlReq): return _guard(lambda: _register(registry.load_sql(r.connection_string, r.query)))

@app.get("/api/v1/datasets/{did}/profile")
def profile(did: str):
    d = _get(DATASETS, did, "dataset"); return {"quality": d["quality"], "pii": d["pii"]}

@app.post("/api/v1/reports/generate")
def generate(r: GenReq):
    d = _get(DATASETS, r.dataset_id, "dataset")
    if r.audience not in ("executive", "analyst"): raise HTTPException(400, "audience must be executive or analyst")
    df = _guard(lambda: explore.apply_filters(d["df"], r.filters, r.date_from, r.date_to))
    if len(df) < 2: raise HTTPException(400, "Filtered view has too few rows to analyze")
    rep = _guard(lambda: report.build_report(df, d["quality"], d["pii"], r.use_llm, metric=r.metric, audience=r.audience))
    rep["view"] = {"filters": r.filters, "date_from": r.date_from, "date_to": r.date_to, "rows": len(df)}
    rid = uuid.uuid4().hex[:12]; REPORTS[rid] = rep
    return {"report_id": rid, **rep}

@app.post("/api/v1/datasets/{did}/explore")
def explore_dataset(did: str, r: ExploreReq):
    d = _get(DATASETS, did, "dataset")
    return _guard(lambda: explore.explore(d["df"], r.filters, r.date_from, r.date_to, r.metric, r.agg))

@app.get("/api/v1/reports/{rid}")
def get_report(rid: str): return _get(REPORTS, rid, "report")

@app.get("/api/v1/reports/{rid}/evaluation")
def get_eval(rid: str): return _get(REPORTS, rid, "report")["evaluation"]

@app.get("/api/v1/reports/{rid}/export", response_class=PlainTextResponse)
def export(rid: str): return report.to_markdown(_get(REPORTS, rid, "report"))
