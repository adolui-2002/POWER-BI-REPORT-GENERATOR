import time
from app.services import analytics, llm_service, guardrails

def _txt(n): return " ".join(" ".join(v) if isinstance(v, list) else str(v) for v in n.values())

def build_report(df, quality, pii, use_llm=True, retries=2, metric=None, audience="executive"):
    t0 = time.time()
    ev = analytics.analyze(df, metric)
    for _ in range(retries + 1):
        narrative, src = llm_service.generate(ev, use_llm, audience)
        chk = guardrails.check_numbers(_txt(narrative), ev)
        if chk["ok"]: break
    else:  # LLM kept producing unverified numbers -> verified template
        narrative, src = llm_service.template(ev, audience), "template-fallback (numeric check failed)"
        chk = guardrails.check_numbers(_txt(narrative), ev)
    evaluation = {"numeric_check": chk, "sections_present": all(narrative.get(k) for k in llm_service.KEYS),
                  "pii_detected": bool(pii), "latency_s": round(time.time() - t0, 2), "narrative_source": src, "audience": audience}
    return {"evidence": ev, "narrative": narrative, "quality": quality, "pii": pii, "evaluation": evaluation}

def to_markdown(r):
    n = r["narrative"]
    L = ["# Data Analytics Report", "", "## Executive summary", str(n["executive_summary"]), "", "## Key findings"]
    L += [f"- {x}" for x in n["findings"]]
    for k, t in [("anomaly_notes", "Anomalies"), ("recommendations", "Recommendations"), ("limitations", "Limitations")]:
        L += ["", f"## {t}"] + [f"- {x}" for x in n[k]]
    e = r["evaluation"]
    L += ["", f"_Narrative source: {e['narrative_source']} · numeric check: {'passed' if e['numeric_check']['ok'] else 'FAILED'}_"]
    return "\n".join(L)
