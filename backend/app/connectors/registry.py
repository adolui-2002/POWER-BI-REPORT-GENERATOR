"""Every connector returns a pandas DataFrame."""
import io, json, ipaddress, socket, sqlite3, os, tempfile
from urllib.parse import urlparse
import pandas as pd, requests
from app.config import MAX_ROWS

FILE_EXT = {"csv", "tsv", "txt", "xlsx", "xls", "json", "jsonl", "ndjson", "xml", "parquet"}

def load_file(name: str, data: bytes) -> pd.DataFrame:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in FILE_EXT:
        raise ValueError(f"Unsupported file type '.{ext}'. Supported: {sorted(FILE_EXT)}")
    b = io.BytesIO(data)
    if ext == "csv": df = pd.read_csv(b, nrows=MAX_ROWS)
    elif ext in ("tsv", "txt"): df = pd.read_csv(b, sep=None, engine="python", nrows=MAX_ROWS)
    elif ext in ("xlsx", "xls"): df = pd.read_excel(b, nrows=MAX_ROWS)
    elif ext == "json": df = pd.json_normalize(json.loads(data))
    elif ext in ("jsonl", "ndjson"): df = pd.read_json(b, lines=True, nrows=MAX_ROWS)
    elif ext == "xml": df = pd.read_xml(b)
    else: df = pd.read_parquet(b)
    return df.head(MAX_ROWS)

def _check_url(url: str):
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("Only http/https URLs are allowed")
    for info in socket.getaddrinfo(p.hostname, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("URL resolves to a blocked (private/local) address (SSRF guard)")

def load_url(url: str) -> pd.DataFrame:
    _check_url(url)
    r = requests.get(url, timeout=20, allow_redirects=False, stream=True)
    if r.is_redirect: raise ValueError("Redirects are blocked")
    r.raise_for_status()
    data = r.raw.read(25 * 1024 * 1024 + 1)
    if len(data) > 25 * 1024 * 1024: raise ValueError("Remote file too large")
    ct = r.headers.get("content-type", "")
    if "html" in ct:
        return pd.read_html(io.StringIO(data.decode("utf-8", "ignore")))[0]
    name = urlparse(url).path.rsplit("/", 1)[-1]
    if "." not in name: name = "data.json" if "json" in ct else "data.csv"
    return load_file(name, data)

def load_sqlite(data: bytes, table: str | None = None) -> pd.DataFrame:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        f.write(data); path = f.name
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        if not tables: raise ValueError("No tables in database")
        table = table or tables[0]
        if table not in tables: raise ValueError(f"Table not found. Available: {tables}")
        df = pd.read_sql_query(f'select * from "{table}" limit {MAX_ROWS}', con)
        con.close(); return df
    finally:
        os.unlink(path)

def load_sql(conn_str: str, query: str) -> pd.DataFrame:
    """PostgreSQL/MySQL/SQL Server via SQLAlchemy (install the DB driver separately). SELECT only."""
    q = query.strip().rstrip(";")
    if not q.lower().startswith("select") or ";" in q:
        raise ValueError("Only single SELECT statements are allowed")
    from sqlalchemy import create_engine
    return pd.read_sql_query(q, create_engine(conn_str)).head(MAX_ROWS)
