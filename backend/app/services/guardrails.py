import re
import pandas as pd

PII = {"email": r"[\w.+-]+@[\w-]+\.[\w.]+", "phone": r"\b\+?\d[\d\s().-]{8,}\d\b", "ssn": r"\b\d{3}-\d{2}-\d{4}\b"}
INJECT = re.compile(r"ignore (all |previous )?instructions|system prompt|you are now|disregard", re.I)

def scan_pii(df: pd.DataFrame, sample=500):
    """Heuristic regex scan only; not a guarantee of anonymisation."""
    found = {}
    for c in df.select_dtypes(include="object").columns:
        s = df[c].dropna().astype(str).head(sample)
        for k, p in PII.items():
            n = int(s.str.contains(p, regex=True).sum())
            if n: found.setdefault(c, {})[k] = n
    return found

def sanitize_text(v) -> str:
    """Dataset text is untrusted: strip injection-like strings, cap length."""
    s = str(v)[:60]
    return "[removed]" if INJECT.search(s) else s

def check_numbers(text: str, evidence: dict):
    """Every number in the narrative must appear in the analytics evidence."""
    nums = set()
    def walk(x):
        if isinstance(x, dict): [walk(v) for v in x.values()]
        elif isinstance(x, list): [walk(v) for v in x]
        elif isinstance(x, (int, float)): nums.add(abs(float(x)))
    walk(evidence)
    bad = []
    text = re.sub(r"\b\d{4}-\d{2}(-\d{2})?\b", " ", text)  # dates are labels, not claims
    for m in re.findall(r"\d[\d,]*\.?\d*", text):
        try: v = float(m.replace(",", "").rstrip("."))
        except ValueError: continue
        if v < 1 or v in (2024, 2025, 2026): continue
        if not any(abs(v - n) <= max(0.01 * n, 0.51) for n in nums):
            bad.append(m)
    return {"ok": not bad, "unverified_numbers": bad}
