"""Interactive (Power BI-style) query layer: slicers, cross-filtering, drill-down. Pure pandas, no FastAPI."""
import json
import numpy as np, pandas as pd

AGGS = {"sum", "mean", "count", "max"}

def date_col(df):
    return next((c for c in df.columns if str(df[c].dtype).startswith("datetime")), None)

def schema(df):
    nums = list(df.select_dtypes("number").columns)
    dc = date_col(df)
    cats = {c: sorted(map(str, df[c].dropna().unique())) for c in df.columns
            if c not in nums and c != dc and df[c].nunique() <= 25}
    s = {"numeric": nums, "categories": cats, "date_col": dc}
    if dc and df[dc].notna().any():
        s["date_min"], s["date_max"] = df[dc].min().strftime("%Y-%m-%d"), df[dc].max().strftime("%Y-%m-%d")
    return s

def apply_filters(df, filters=None, date_from=None, date_to=None):
    for c, vals in (filters or {}).items():
        if c in df.columns and vals:
            df = df[df[c].astype(str).isin([str(v) for v in vals])]
    dc = date_col(df)
    if dc:
        if date_from: df = df[df[dc] >= pd.to_datetime(date_from)]
        if date_to: df = df[df[dc] <= pd.to_datetime(date_to) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)]
    return df

def _r(x): return None if pd.isna(x) or np.isinf(x) else round(float(x), 2)

def explore(df, filters=None, date_from=None, date_to=None, metric=None, how="sum"):
    if how not in AGGS: raise ValueError(f"agg must be one of {sorted(AGGS)}")
    sc = schema(df)
    if not sc["numeric"]: raise ValueError("No numeric columns to analyze")
    metric = metric if metric in sc["numeric"] else sc["numeric"][0]
    dc = sc["date_col"]
    f = apply_filters(df, filters, date_from, date_to)
    out = {"metric": metric, "agg": how, "rows": len(f), "total_rows": len(df), "date_col": dc,
           "kpis": {}, "monthly": [], "breakdowns": {}, "matrix": None, "anomalies": [], "table": []}
    if f.empty: return out
    all_sum = float(df[metric].sum())
    out["kpis"] = {"count": len(f), "sum": _r(f[metric].sum()), "mean": _r(f[metric].mean()), "max": _r(f[metric].max()),
                   "pct_of_total": round(float(f[metric].sum()) / all_sum * 100, 1) if all_sum else None}
    if dc:
        m = f.set_index(dc)[metric].resample("MS").agg(how).dropna()
        ch = m.pct_change() * 100
        out["monthly"] = [{"month": k.strftime("%Y-%m"), "value": _r(v), "change_pct": _r(c) if c == c else None}
                          for (k, v), c in zip(m.items(), ch)]
    for c in sc["categories"]:   # a chart ignores its own filter so selected vs unselected stays visible
        fc = apply_filters(df, {k: v for k, v in (filters or {}).items() if k != c}, date_from, date_to)
        if fc.empty: out["breakdowns"][c] = []; continue
        g = fc.groupby(c)[metric].agg(how).sort_values(ascending=False)
        out["breakdowns"][c] = [{"name": str(k), "value": _r(v)} for k, v in g.items()]
    cats = list(sc["categories"])[:2]
    if len(cats) == 2:
        pv = f.pivot_table(index=cats[0], columns=cats[1], values=metric, aggfunc=how, fill_value=0)
        out["matrix"] = {"row_col": cats[0], "col_col": cats[1], "rows": [str(x) for x in pv.index],
                         "cols": [str(x) for x in pv.columns], "cells": [[_r(v) for v in r] for r in pv.values]}
    z = (f[metric] - f[metric].mean()) / (f[metric].std() or 1)
    flag = z.abs() > 3
    top = z[flag].abs().sort_values(ascending=False).head(10)
    out["anomalies"] = [{"_row": int(i), "value": _r(f.loc[i, metric]), "z": _r(z[i])} for i in top.index]
    t = f.sort_values(dc) if dc else f
    t = t.head(1000).copy()
    t["_anom"] = flag.reindex(t.index).values
    t.insert(0, "_row", t.index)
    if dc: t[dc] = t[dc].dt.strftime("%Y-%m-%d")
    out["table"] = json.loads(t.to_json(orient="records"))
    return out
