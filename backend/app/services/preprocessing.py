import re
import pandas as pd

def clean(df: pd.DataFrame):
    """Returns (clean_df, quality_report). Original df is untouched."""
    warnings, raw_rows = [], len(df)
    df = df.copy()
    df.columns = [re.sub(r"\W+", "_", str(c).strip().lower()).strip("_") for c in df.columns]
    dups = int(df.duplicated().sum())
    if dups: warnings.append(f"{dups} duplicate rows removed")
    df = df.drop_duplicates()
    for c in df.columns:
        if pd.api.types.is_object_dtype(df[c]) or pd.api.types.is_string_dtype(df[c]):
            num = pd.to_numeric(df[c], errors="coerce")
            if num.notna().mean() > 0.9: df[c] = num; continue
            if any(k in c for k in ("date", "time", "month", "day")):
                dt = pd.to_datetime(df[c], errors="coerce")
                if dt.notna().mean() > 0.9: df[c] = dt
    missing = {c: int(n) for c, n in df.isna().sum().items() if n}
    if missing: warnings.append(f"Missing values: {missing}")
    if len(df) < 100: warnings.append(f"Only {len(df)} rows; below the recommended 100-row minimum")
    q = {"raw_rows": raw_rows, "rows": len(df), "columns": list(df.columns), "duplicates_removed": dups,
         "missing": missing, "warnings": warnings}
    return df, q
