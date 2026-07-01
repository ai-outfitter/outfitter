# Demo video shooting script — Outfitter research preview

Prep artifact for fork issue #6 (Record and publish the research-preview demo video). This covers the script and rehearsal plan only; recording, editing, and publishing remain open on the issue.

- **Format:** casual one-take feel (Imbue-style), OBS, solo or two-presenter open.
- **Target length:** ≤ 8 minutes total. Beat timings below sum to 7:55.
- **The promise the video makes:** "Follow along and you'll have a fully configured Pi setup in five minutes." The install-to-working-session segment must be real time — no cuts hiding failures.
- **Value prop line (say it verbatim, at least twice):** _"Make, share, and switch the profiles your coding agents use — manually or programmatically."_

---

## Beat sheet

### Beat 1 — Cold open / intro (0:00–0:20, 20s)

| SAY                                                                                                                                                                                                                                                           | SHOW                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "Hey — we're going to show you Outfitter, a research preview we've been building. It's a small tool that makes, shares, and switches the profiles your coding agents use. In about five minutes of following along, you'll have a fully configured Pi setup." | Presenter(s) on camera, or face-cam corner over a clean desktop. Title card: "Outfitter — research preview" + repo URL lower-third. |

**Notes:** No feature tour language. State it's a research preview in the first 20 seconds so the framing is honest from the start.

### Beat 2 — The problem: Nicholas's day (0:20–1:20, 60s)

| SAY                                                                                                                                                                                                                                                                                                                                                                                                                           | SHOW                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Here's the problem. Nicholas is a platform engineer. In a single day he's doing feature work, then he's paged into a prod incident, then he's off on a research spike. Each of those needs a different agent: different context, different tools, different model, different level of caution."                                                                                                                              | Screen: a bloated agent config — a giant system prompt file, a wall of MCP servers/extensions, dozens of skills. Optionally a quick three-panel graphic: "feature work / prod incident / research spike." |
| "The usual answer is to load everything at once — every tool, every skill, all the context. And that degrades the agent everywhere. The context window fills with stuff that's irrelevant to the task at hand, tool choice gets noisy, and the agent gets slower and dumber at all three jobs. What Nicholas actually wants is to gear-switch: a focused loadout per kind of work, and a way to flip between them instantly." | Scroll the bloated config slowly while talking — let the excess make the point. End the beat on the word "gear-switch."                                                                                   |

**Notes:** This is the authentic narrative from the dry run. Keep it concrete — name the three modes of work every time.

### Beat 3 — Value prop + the hook (1:20–1:50, 30s)

| SAY                                                                                                                                                                                                                                         | SHOW                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "That's Outfitter: make, share, and switch the profiles your coding agents use — manually or programmatically. A profile is just YAML: prompts, context, model, thinking level, extensions, skills — composed and launched as one loadout." | Cut to a short, readable `profile.yml` (the `engineer` example) — one screenful, big font. Highlight `model`, `thinking`, `append_system_prompt` with cursor. |
| "And this isn't a talk — follow along, and you'll have a fully configured Pi setup in five minutes. Starting the clock now."                                                                                                                | On-screen timer starts (small, persistent corner element in OBS). Cut to an empty terminal.                                                                   |

**Notes:** The visible timer is the credibility device. It stays on screen through Beat 5.

### Beat 4 — Live: install and first run (1:50–3:20, 90s)

| SAY                                                                                                                                                                                     | SHOW                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| "One install. Outfitter wraps agent CLIs — Pi first — so you install it globally and just run it."                                                                                      | Type, live: `npm install -g @ai-outfitter/outfitter`. Let it run for real.                         |
| "Now the whole thing is one command." (While onboarding assets download: narrate what it's doing — syncing the default profile catalog, fetching extensions — don't dead-air the wait.) | Type: `outfitter`. First-run onboarding begins inside Pi. Keep the terminal full-screen, big font. |

**Notes:** This is the segment that must not be cut. If provider login is needed, do it on camera — it's part of the honest five minutes (see failure points).

### Beat 5 — Onboarding: pick a profile, land in Pi (3:20–4:50, 90s)

| SAY                                                                                                                                                                                                                         | SHOW                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Onboarding runs natively inside Pi. It asks who you are, not fifty config questions. I'll take engineer — but notice founder and data analyst are right there. These come from a shared catalog repo, which we'll get to." | The profile picker: **founder / engineer / data analyst**. Arrow through all three so viewers see the descriptions, select `engineer`.                                                        |
| "And that's it — I'm in a Pi session, configured as an engineer: the prompt, the skills, the extensions, the model and thinking level all came from the profile. Check the clock."                                          | Land in the live Pi session. Show the loadout evidence: run a quick command or open the skills/tools listing so the engineer-specific setup is visibly present. Point at the on-screen timer. |

**Notes:** Under five minutes on the timer here is the payoff of the hook. Rehearse until this lands with margin (target ~4:30 wall time from Beat 3's clock start).

### Beat 6 — The money shot: switching loadouts (4:50–6:00, 70s)

| SAY                                                                                                                                                                                                                                                                                                                                                                                                                       | SHOW                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Here's the part that changes Nicholas's day. Watch me gear-switch."                                                                                                                                                                                                                                                                                                                                                      | Exit Pi. Type: `outfitter -p founder` (or `outfitter -p data-analyst` — pick the profile with the most visibly different loadout).                                                                                                                            |
| "Same machine, same command, completely different agent: different system prompt, different skills, different tools, different model and thinking level. Feature work, prod incident, research spike — each gets its own focused loadout, and none of them pays the context tax of the others. And because it's a flag, it's scriptable — switch profiles programmatically from CI, cron, whatever launches your agents." | Side-by-side or quick back-to-back: show the skills/tools listing in this session vs. the engineer session. The visual delta between the two lists IS the shot — linger on it. Optionally a third fast switch (`outfitter -p engineer`) to show it's instant. |

**Notes:** Rehearse the exact evidence commands so the two loadout listings are obviously different at a glance. This beat carries the whole thesis.

### Beat 7 — Make your own (6:00–6:50, 50s)

| SAY                                                                                                                                                                                                                                          | SHOW                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Making a profile doesn't require a manual. You're already sitting inside an agent — so ask it. 'Make me a profile for reviewing pull requests on this repo.' It writes the YAML; profiles are just files, so you can read the whole thing." | From inside the Pi session, type a natural-language request: _make me a profile for X_ (pick a concrete, rehearsed X). Show the generated profile YAML — scroll it, it should fit in ~one screen. |
| "Tweak it like any file, and it's in your picker next launch."                                                                                                                                                                               | Quick flash: the new profile appearing in `outfitter profile list` or the picker.                                                                                                                 |

**Notes:** Keep the generation request small and rehearsed so the YAML comes out clean on camera.

### Beat 8 — Share it: catalog repos (6:50–7:30, 40s)

| SAY                                                                                                                                                                                                                                                                                                                                    | SHOW                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Because profiles are files, sharing is a git repo. Those founder, engineer, and data analyst profiles came from our default catalog. Point Outfitter at your team's repo — `outfitter setup <repo-url>` — and everyone on the team gets the same roles, synced with `outfitter sync`. That's the 'share' in make, share, and switch." | Show the default-profiles repo on GitHub (profiles/ tree), then the one-liner: `outfitter setup https://github.com/<org>/<catalog>`. No need to run a second full setup on camera. |

**Notes:** Say the value prop line again here, in full — this is its second and final verbatim appearance.

### Beat 9 — Close (7:30–7:55, 25s)

| SAY                                                                                                                                                                                                           | SHOW                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Outfitter is a research preview — it's early, it's open source, and Pi is the first-class path today. If you live in a terminal agent, try it, break it, and tell us. Repo link below. Thanks for watching." | End card: repo URL (`github.com/ai-outfitter/outfitter`), `npm install -g @ai-outfitter/outfitter`, "Research preview" label, link to docs. Hold 5s. |

**Total: 7:55.**

---

## Pre-flight checklist

Machine and environment:

- [ ] **Clean machine or VM decided and prepared.** Recommendation: record on a fresh VM (or a scrubbed macOS user account) so the install is genuinely first-run — no `~/.outfitter`, no `~/.pi`, no global install, no npm cache surprises. Snapshot the VM so retakes reset in seconds.
- [ ] **Warm vs. cold cache decision made and written down.** The honest default is **cold** for Beat 4–5 (the five-minute promise is a cold-start promise). If cold first-boot cannot reliably land under the timer on normal broadband, that is a ship-blocker on the recording (see fork issues #1/#4), not something to hide with a warm cache. If a warm cache is used anyway, say so on camera in one sentence.
- [ ] **Network verified:** stable broadband, no corporate proxy/VPN, GitHub and npm reachable. Run a full timed cold rehearsal on this exact network the same day.
- [ ] **Provider login state decided:** either pre-authenticated (and say so) or the login flow is rehearsed and included in the timed segment.
- [ ] **Pinned versions:** note the exact `@ai-outfitter/outfitter` and Pi versions being demoed; do not record across a release boundary.

Terminal presentation:

- [ ] Terminal font size 18–22pt minimum; verify legibility at 1080p **and** in a 480p preview (most viewers watch small).
- [ ] High-contrast theme; no transparency; window sized to the OBS canvas exactly (no scaling blur).
- [ ] Shell prompt minimal (no personal hostname/paths); `cd` into a neutral demo directory.
- [ ] Shell history cleaned or fresh user (no autosuggest leaking previous takes).
- [ ] Notifications off (OS Do Not Disturb), no menu-bar clutter, dock hidden.

OBS:

- [ ] **Scenes built:** (1) full-screen terminal, (2) terminal + face-cam corner, (3) browser (GitHub repo) for Beat 8, (4) title/end cards, (5) side-by-side layout for Beat 6 if used.
- [ ] **On-screen timer element** configured for Beats 3–5 (stopwatch source or scripted text source), start/stop hotkeys bound.
- [ ] Mic checked at speaking distance; record a 30s test and listen back; audio levels around −12 dB peak.
- [ ] Recording at 1080p/30 minimum, high bitrate; local recording (not just stream).
- [ ] Scene-switch hotkeys rehearsed so switching doesn't require mousing through OBS on camera.

Content:

- [ ] Profile picker shows exactly **founder / engineer / data analyst** with sensible descriptions (verify against the current default-profiles catalog before recording).
- [ ] The two loadout-evidence commands for Beat 6 chosen and rehearsed; the visual diff between profiles is obvious.
- [ ] The "make me a profile for X" request chosen, rehearsed, and produces clean YAML.
- [ ] End-card links verified (repo URL, npm package name).

---

## Failure points to rehearse (with fallbacks)

Run at least two full cold-start rehearsals, timed, before the real take. Known risks, in order of likelihood:

1. **First-boot extension download/build stall.** The dry run stalled for minutes cloning and building extensions. Rehearse the exact cold-start timing on the recording network. Mitigation: verify the extension-caching and shallow-clone work (fork issues #1/#4) is released before recording; have narration ready that fills up to ~45s of download honestly ("it's pulling the catalog and extensions — this is the slow part, once, on first boot"). Abort criterion: if cold boot exceeds ~90s in both rehearsals, do not record — fix the boot first.
2. **Provider login flow.** First run may route through login/auth. Rehearse both paths: pre-authenticated (say so on camera) and live login (know exactly which screens appear, have credentials ready, confirm no secrets are visible on screen — use a demo account). Decide before recording which path the take uses.
3. **Stale onboarding / cache interplay.** A previous take's `~/.outfitter` or `~/.pi` state can replay an old flow or skip the picker. Always reset from the VM snapshot between takes; never re-record over a dirty home dir.
4. **Bootstrap model availability.** Onboarding historically injected a hardcoded model; catalog rotation breaks it silently. Verify on the rehearsal day that the onboarding model path works with the demo account's providers (fork issue #2).
5. **"Update available" notice right after installing.** Ruins the "fresh install" credibility shot. Verify the notice is absent on the pinned version (fork issue #3); if present, mention it as known-preview jank in one clause rather than pretending it isn't there.
6. **Network flake mid-take.** git clone or npm fetch fails transiently. Fallback: VM snapshot + restart the take; do not splice.
7. **Profile-generation beat produces bad YAML.** The "make me a profile" request is model-dependent. Rehearse the exact phrasing; if output is ugly on the take, edit it on camera briefly — "profiles are just files" makes that recoverable, not embarrassing.
8. **Timer overrun.** If the Beat 3–5 segment crosses five minutes on the take, do not fake it: either keep the take and own it ("okay, six minutes with the login") or reset and re-take. Never trim the timer segment in edit.

---

## Publishing (tracked on fork issue #6, not covered by this script)

YouTube upload, README embed/link, and doc-site link land with the issue itself. Acceptance criteria there: video live, README links it, ≤ 8 minutes, install-to-working-session segment real-time.
