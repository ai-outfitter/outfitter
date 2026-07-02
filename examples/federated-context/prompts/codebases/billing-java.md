# Codebase: billing-java (fictional example)

Legacy Java 8 monolith that computes invoices, proration, and tax for all product lines. Owned by the payments team; deployed as a single WAR to an on-prem Tomcat pool.

- Build: Maven multi-module (`billing-core`, `billing-tax`, `billing-web`). `mvn -pl billing-core test` is the fast loop; the full build takes ~20 minutes.
- Persistence: raw JDBC against Oracle. There is no ORM; SQL lives in `*Dao.java` classes. Never introduce a new persistence framework in a bugfix.
- The proration engine (`billing-core/src/main/java/.../Proration.java`) is the highest-risk file in the company. Any change requires a golden-file test in `billing-core/src/test/resources/proration/`.
- Dates are handled with `java.util.Calendar` throughout. Do not mix in `java.time` within a single module; migration happens module-by-module.
- Feature flags come from a database table read at startup; there is no runtime toggling. Assume a restart is required.
