# Outfitter — Project Log

Chronological log of development activities, changes, and lessons learned. Append new entries; never remove old ones.

## 2026-07-01 (later) — Cross-adapter conformance suite (Claude session, wave2/conformance)

**What was done:**

- Implemented the cross-adapter conformance test suite (issue #19 / plan issue 21) under `code/cli/tests/conformance/`: a declaration module (`ConformanceSpec.ts` types + doc mapping, `ConformanceRows.ts` with 23 rows covering model, provider, thinking, environment, args, pass-through args, agent config dir, session dir, extensions, skills, prompt_template, native commands, system/append prompts, deepwork, MCP fragments, state paths, and the roadmap concepts), a registry-driven runner (`conformance.test.ts`) and a docs drift verifier (`support-matrix-drift.test.ts`).
- Every adapter in `AgentRegistry.supportedAgentIds` must declare Supported (behavior asserted), Roadmap (exact warning text + `--strict` escalation via `executeRunCommand`), or Not Applicable (justification) for every row; a new adapter fails the suite until it declares all rows.
- Docs drift prevention: chose a verifier over a generator — the matrices live inside hand-written prose docs, so the tests parse both tables (`docs/documentation/support-matrix.md` fine-grained with Partial; `docs/architecture/controllable-elements.md` coarse per OFTR-007.2's Supported/Roadmap/Unsupported vocabulary) and assert every row/column agrees with the aggregated conformance declarations. Added `npm run conformance` as the one-command proof.
- Docs: added MCP servers and DeepWork job selection rows to the support matrix (previously undocumented in the table), an MCP note in the Pi notes, the conformance-suite pointer, and the new tests directory in `file_structure.md`.

**Key findings / lessons:**

- No genuine status mismatches existed between the current matrices and adapter behavior; the gaps were missing rows (MCP, DeepWork) rather than wrong cells.
- OFTR-007.2.4 restricts the architecture matrix cells to `Unsupported|Supported|Roadmap`, so "Partial" must not be introduced there; the doc's own "How to Read This Matrix" prose justifies coarsening Partial→Supported for that file only.
- The two matrices intentionally differ in vocabulary; the conformance spec encodes that with a per-file `statusVocabulary` so both stay verified without contradiction.

## 2026-07-01 (later) — Update plan drafted as local issue queue (Claude session)

**What was done:**

- Built the comprehensive update plan from the assessment: `docs/plans/2026-07-01-update-plan.md` — 34 atomic issues across 5 milestones (M1 ship-blockers, M2 hardening, M3 Claude parity, M4 docs, M5 strategic/distribution).
- Decisions locked with Tyler: GitHub issues + repo specs for tracking (manual approval required before filing anything), full Claude adapter parity now, keep the Outfitter name (differentiate via SEO/positioning), scope includes strategic work.
- Stored all 34 issues as ready-to-file drafts under `docs/plans/issues/` (frontmatter metadata + verbatim GitHub issue bodies) — **local only for now**, to be filed later via `scripts/file-issues.mjs` (dry-run by default; `--file` to create; `--only NN,NN` for subsets). Dry run verified all 34 parse.

## 2026-07-01 — Comprehensive product/market assessment (Claude session)

**What was done:**

- Deep review of the full repo at v0.7.0 (architecture, code quality, maturity), all docs (`docs/`, doc_site, requirements OFTR-001..010), and release/packaging setup.
- Pulled and analyzed the demo context: Nicholas/Tyler demo-video dry run transcript (Jul 1), Tyler/Jamie Erickson call (Jun 29, Grain), Weekly Demo notes (Jun 29, Grain).
- Fresh market research (mid-2026): competitive landscape (Ruler/rulesync/block-ai-rules; AGENTS.md + SKILL.md + MCP registry standards; Claude Code marketplaces / Codex Team Config; Docker cagent; Pi packages), demand signals (rule drift, DORA 2025, SO 2025, CSA attack-surface note), market sizing, positioning wedges.
- Produced prioritized assessment: `docs/plans/2026-07-01-comprehensive-assessment.md`. Created `project-plan.md` and this log.

**Key findings / lessons:**

- Core engine is production-quality with exceptional test discipline (99% coverage enforced, requirement-pinning tests, strong state-persistence design, real security hygiene).
- Risk is concentrated in the first five minutes: network-required first run, hardcoded `google/gemini-3.1-pro-preview` bootstrap model, ~750-line untyped JS onboarding extension string, onboarding regressions that broke the demo dry run itself.
- Claude adapter is materially behind the multi-agent marketing; either scope the claim or reach parity.
- Market: pain validated ("rule drift", DORA org-standardization), but rules-sync layer commoditized and vendors are absorbing single-vendor catalogs. Defensible ground = vendor-neutral compose-and-launch + git org catalogs, anchored in the Pi ecosystem (zero incumbent). Brand collision with unrelated `outfitter-dev/agents` marketplace.
- Jamie (field/sales) signal: enterprises want AI SDLC toolkits / federated context / governance planes; his verdict — "doesn't need more features, needs polishing and release."
