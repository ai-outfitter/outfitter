---
name: billing-java
description: Fictional billing-java codebase constraints.
---

# Codebase: billing-java

Legacy Java 8 monolith for invoices, proration, and tax, owned by payments and deployed as one WAR.

- Maven modules: `billing-core`, `billing-tax`, `billing-web`; use `mvn -pl billing-core test` for the fast loop.
- Persistence is raw JDBC against Oracle. Do not introduce a persistence framework in a bugfix.
- Changes to `Proration.java` require a golden-file test under `billing-core/src/test/resources/proration/`.
- Do not mix `java.time` into a module still using `java.util.Calendar`.
- Feature flags are read from the database at startup; assume a restart is required.
