# Codebase: inventory-python (fictional example)

Python data platform that forecasts stock levels and reorder points across warehouses. Owned by the supply-chain team.

- Layout: `pipelines/` (Airflow DAGs), `libs/forecast/` (pure functions, fully typed), `notebooks/` (exploration only — never imported by production code).
- Tooling: Python 3.12, uv for environments, ruff for lint/format, pytest with `--cov=libs` gate at 90% for `libs/forecast/`.
- DataFrames are Polars, not pandas. Pandas appears only at third-party API boundaries and must be converted at the edge.
- Every DAG must be idempotent per `(warehouse_id, date)` partition; backfills are routine and unannounced.
- Forecast model changes require a backtest report committed under `reports/` comparing against the last released model before merge.
