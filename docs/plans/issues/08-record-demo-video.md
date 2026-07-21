---
title: Record and publish the research-preview demo video
labels: [launch, m1-ship-blockers, plan-2026-07]
size: M
depends_on: [1, 2, 5, 6]
---

## Problem

Launch needs its primary asset. The script converged in the 2026-07-01 working session; the recording was blocked by first-run bugs (tracked separately).

## Scope

Script beats (as agreed):

1. ~20s intro (two-presenter open or solo casual, Imbue-style)
2. Problem narrative: platform engineer constantly gear-switching (feature work / prod incident / research spike); one bloated setup degrades everything
3. Value prop: **"Make, share, and switch the profiles your coding agents use — manually or programmatically"**
4. Hook: "follow along and you'll have a fully configured Pi setup in five minutes"
5. Live: `npm install -g @ai-outfitter/outfitter` → `outfitter` → onboarding → profile picker → in Pi
6. The money shot: switch loadouts (`outfitter -p debug`) — different skills/tools/context instantly
7. Make-your-own ("make me a profile for X") + share via catalog repo
8. Close: repo link, research preview framing

Production: OBS; casual one-take feel; ≤ 8 minutes. Publish to YouTube; embed/link in README and doc site.

## Acceptance criteria

- Video live and linked from README.
- The install-to-working-session segment is real-time (no cuts hiding failures).
