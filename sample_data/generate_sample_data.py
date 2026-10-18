"""Synthetic sales data (no real/PII data). Run: python generate_sample_data.py"""
import numpy as np, pandas as pd, sqlite3
rng = np.random.default_rng(42)
n = 600
dates = pd.to_datetime("2025-01-01") + pd.to_timedelta(rng.integers(0, 365, n), unit="D")
region = rng.choice(["East", "West", "North", "South"], n, p=[.35, .28, .15, .22])
product = rng.choice(["Laptop", "Phone", "Tablet", "Monitor", "Accessories"], n, p=[.25, .3, .15, .15, .15])
price = {"Laptop": 1000, "Phone": 600, "Tablet": 450, "Monitor": 300, "Accessories": 60}
units = rng.integers(1, 12, n)
rev = np.array([price[p] for p in product]) * units * rng.normal(1, .08, n) * (1 + dates.month.values / 40)
rev = np.where((product == "Tablet") & (dates.month.values >= 9), rev * .55, rev)   # planted category decline
rev[[50, 300]] *= 9                                                                  # planted anomalies
df = pd.DataFrame({"date": dates.strftime("%Y-%m-%d"), "region": region, "product": product,
                   "revenue": rev.round(2), "units_sold": units}).sort_values("date").reset_index(drop=True)
df.to_csv("sales_data.csv", index=False); df.to_csv("sales_data.tsv", index=False, sep="\t")
df.to_json("sales_data.json", orient="records", indent=1); df.to_json("sales_data.jsonl", orient="records", lines=True)
df.to_excel("sales_data.xlsx", index=False); df.to_xml("sales_data.xml", index=False)
df.to_parquet("sales_data.parquet", index=False)
con = sqlite3.connect("sales_data.db"); df.to_sql("sales", con, if_exists="replace", index=False); con.close()
print("generated", len(df), "rows in 8 formats")
