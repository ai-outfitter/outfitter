---
name: inventory-python
description: Fictional inventory-python codebase constraints.
---

# Codebase: inventory-python

Python data platform for warehouse stock forecasts and reorder points.

- Python 3.12, uv, ruff, and pytest; `libs/forecast/` has a 90% coverage gate.
- Use Polars. Convert pandas values only at third-party boundaries.
- Every DAG is idempotent per `(warehouse_id, date)` partition.
- Forecast-model changes require a committed backtest report comparing the prior release.
