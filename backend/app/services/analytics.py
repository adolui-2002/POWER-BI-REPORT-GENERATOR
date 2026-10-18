import numpy as np, pandas as pd
from app.services.guardrails import sanitize_text

def analyze(df: pd.DataFrame, metric: str | None = None) -> dict:
    nums = list(df.select_dtypes("number").columns)
    dates = [c for c in df.columns if str(df[c].dtype).startswith("datetime")]
    cats = [c for c in df.select_dtypes(exclude="number").columns if c not in dates and df[c].nunique() <= 25]
    if not nums: raise ValueError("No numeric columns found to analyze")
    metric = metric if metric in nums else ("revenue" if "revenue" in nums else nums[0])
    ev = {"rows": len(df), "metric": metric, "total": round(float(df[metric].sum()), 2),
          "average": round(float(df[metric].mean()), 2), "median": round(float(df[metric].median()), 2)}
    if "units_sold" in nums and metric != "units_sold": ev["total_units"] = int(df["units_sold"].sum())
    ev["by_category"] = {}
    for c in cats[:3]:
        g = df.groupby(c)[metric].sum().sort_values(ascending=False)
        ev["by_category"][c] = {sanitize_text(k): round(float(v), 2) for k, v in g.items()}
        ev["by_category"][c + "_top_share_pct"] = round(float(g.iloc[0] / g.sum() * 100), 1)
    if dates:
        m = df.set_index(dates[0])[metric].resample("MS").sum()
        chg = (m.pct_change() * 100).round(1).dropna()
        ev["monthly"] = {k.strftime("%Y-%m"): round(float(v), 2) for k, v in m.items()}
        ev["monthly_change_pct"] = {k.strftime("%Y-%m"): float(v) for k, v in chg.items()}
        if len(m) >= 3:
            slope = float(np.polyfit(range(len(m)), m.values, 1)[0])
            ev["trend"] = {"direction": "up" if slope > 0 else "down", "slope_per_month": round(slope, 2)}
    z = (df[metric] - df[metric].mean()) / (df[metric].std() or 1)
    out = df[z.abs() > 3]
    ev["anomalies"] = [{"row": int(i), "value": round(float(df.loc[i, metric]), 2), "z_score": round(float(z[i]), 2)} for i in out.index[:10]]
    ev["anomaly_count"] = int(len(out)); ev["z_threshold"] = 3
    if len(nums) > 1:
        cm = df[nums].corr()
        pairs = [(a, b, abs(cm.loc[a, b])) for i, a in enumerate(nums) for b in nums[i + 1:] if pd.notna(cm.loc[a, b])]
        if pairs:
            a, b, _ = max(pairs, key=lambda t: t[2]); ev["top_correlation"] = {"pair": [a, b], "r": round(float(cm.loc[a, b]), 2)}
    return ev
