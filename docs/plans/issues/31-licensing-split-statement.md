---
title: State the licensing split publicly
labels: [strategy, m5-strategic, plan-2026-07]
size: S
---

## Problem

`code/enterprise/` is a BSL-style license shell with zero code and no explanation — an enterprise ambition visible in the tree but unexplained to users. The working model (from the 2026-06-29 discussions): open/MIT for individual + team use, enterprise license for private-catalog/org features, monetize training and support early. Prospective org adopters currently cannot answer "what's free, what will cost money?"

## Scope

- README "Licensing" section: what is MIT/open today, what the enterprise license will cover (private catalog features, org governance), and the training/support offering posture.
- `code/enterprise/README.md`: explain what will live there and why it exists now.
- Verify LICENSE.md boundaries are unambiguous about which paths carry which license.

## Acceptance criteria

- A prospective org user can answer the free-vs-paid question from the README alone.
- Enterprise directory no longer reads as an unexplained mystery.

## References

- `code/enterprise/LICENSE`, `code/enterprise/README.md`, `LICENSE.md`
- Jamie call + Weekly Demo notes (2026-06-29): public-MIT / private-enterprise licensing sketch
