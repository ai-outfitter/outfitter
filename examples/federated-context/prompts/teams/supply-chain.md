# Team: supply-chain (fictional example)

Working agreements for agents acting in supply-chain-owned repositories.

- Data quality first: a wrong forecast quietly costs more than a broken DAG. Prefer failing loudly over imputing silently.
- Any change that alters forecast outputs must link a backtest report; reviewers reject "the tests pass" as sufficient evidence.
- Warehouse calendars differ by region. Never hardcode weekends, holidays, or cutoff times; read them from the calendar service.
- Coordinate with the payments team before touching anything that feeds landed-cost calculations.
