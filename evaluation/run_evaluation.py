"""Offline benchmark: runs every sample format through the pipeline, checks numeric accuracy,
sections and latency. Run from repo root: python evaluation/run_evaluation.py"""
import sys, time, pathlib, statistics
import pandas as pd
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
from app.connectors import registry
from app.services import preprocessing, guardrails, report

S = pathlib.Path(__file__).resolve().parents[1] / "sample_data"
truth = pd.read_csv(S / "sales_data.csv").drop_duplicates()["revenue"].sum().round(2)
rows, lat = [], []
for f in sorted(S.glob("sales_data.*")):
    if f.suffix == ".py": continue
    data = f.read_bytes()
    df = registry.load_sqlite(data) if f.suffix == ".db" else registry.load_file(f.name, data)
    t = time.time(); df, q = preprocessing.clean(df)
    r = report.build_report(df, q, guardrails.scan_pii(df), use_llm=False)
    lat.append(time.time() - t)
    rows.append((f.name, r["evidence"]["total"] == truth, r["evaluation"]["numeric_check"]["ok"], r["evaluation"]["sections_present"]))
print(f"{'file':22}{'total_exact':13}{'numbers_ok':12}sections")
for r in rows: print(f"{r[0]:22}{str(r[1]):13}{str(r[2]):12}{r[3]}")
print(f"\npass rate: {sum(all(r[1:]) for r in rows)}/{len(rows)} | median latency {statistics.median(lat):.2f}s (target < 60s)")
print("Human-rated quality (85% target) must be collected with a rubric; it is not computed here.")
