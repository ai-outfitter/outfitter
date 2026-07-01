# Ecosystem listings + announcement copy

Prep artifact for fork issue #28 (Ecosystem listings & Pi community presence). Copy below is ready to submit; the submissions themselves are human actions and stay open on the issue. Timing per the update plan: fire alongside the demo video (fork issue #6), after M1 lands.

Verification notes (2026-07-01):

- `bradAGI/awesome-cli-coding-agents` exists and is active (~707 stars, 90+ entries). Structure: **Terminal-native coding agents** (Open Source / OpenClaw ecosystem / Closed Source) and **Harnesses & orchestration** (Session managers & parallel runners / Orchestrators & autonomous loops / **Agent infrastructure**). Contribution requirements from the repo: CLI/terminal interface (not IDE-only); autonomous code read/write or command execution; valid active links; correct position by star count within the section.
- Pi's official community Discord is linked from https://pi.dev ("Get involved with Pi" → community server: https://discord.com/invite/nKXTsAcmbT). Pi packages are shared via npm and Discord per the Pi coding-agent README.
- `hesreallyhim/awesome-claude-code` exists (curated skills/hooks/commands/orchestrators for Claude Code).

---

## (a) awesome-cli-coding-agents entry (ready to submit)

Target section: **Harnesses & orchestration → Agent infrastructure**, positioned by star count (Outfitter is currently at the bottom; update the `⭐` count to the live number on submission day — their reviewers check ordering).

Entry, in their exact list format (`**[Name](url)** \`⭐ N\` — description`):

```markdown
**[Outfitter](https://github.com/ai-outfitter/outfitter)** `⭐ 3` — Profile manager and launcher for coding-agent CLIs: compose prompts, model/thinking settings, skills, extensions, and MCP config into switchable YAML profiles, shared via git catalogs. Pi-first, with Claude Code support.
```

PR title: `Add Outfitter (agent infrastructure)`

PR description (one paragraph):

> Adds Outfitter to Agent infrastructure. It's a launcher/profile layer above agent CLIs (Pi first, Claude Code partial): profiles are YAML composing prompts, models, skills, extensions, and MCP config; catalogs are git repos so teams share and pin loadouts; `outfitter -p <profile>` switches the whole loadout per launch. Terminal-native, open source (research preview). Meets the criteria via the wrapped agents' autonomous read/write/exec; Outfitter itself is the config/launch infrastructure around them.

Fit check against their criteria: CLI/terminal ✓; autonomous read/write/exec — Outfitter launches agents that do this (same category basis as other infrastructure entries) ✓; links valid ✓; ordering by stars — verify on the day ✓.

## (b) Pi Discord announcement (~150 words)

Post in the community server's most fitting channel (look for show-and-tell / packages / projects; read the channel norms first). Draft:

> Hey all — we built a thing for a problem we kept hitting with Pi and figured this crowd hits it too.
>
> One of us is a platform engineer who bounces between feature work, prod incidents, and research spikes all day. Each needs a different agent setup — different context, tools, model, thinking level. Loading everything at once just makes the agent worse at all of it.
>
> So: **Outfitter**. Profiles are plain YAML — prompts, model/thinking, skills, extensions, MCP config — and `outfitter -p incident` launches Pi with that whole loadout. Profiles live in git repos, so teams can share and pin them. Pi is the first-class target; there's a recommended engineering loadout out of the box.
>
> It's an open-source research preview, so it's early and we want it broken: https://github.com/ai-outfitter/outfitter — install is `npm i -g @ai-outfitter/outfitter`, then `outfitter`. Feedback very welcome.

(~145 words. Adjust the greeting/channel etiquette to whatever the server actually uses; attach the demo video link once it exists.)

## (c) Show HN draft

**Title** (79 chars, fits HN's 80-char limit):

> Show HN: Outfitter – Make, share, and switch the profiles your coding agents use

**First comment** (post immediately after submitting):

> Hi HN — we're the maintainers. Outfitter is a small open-source launcher that sits above coding-agent CLIs (Pi today, Claude Code partially).
>
> The itch: if you use a terminal agent for real work, you end up with one bloated setup — every MCP server, every skill, a kitchen-sink system prompt — because reconfiguring per task is annoying. That degrades the agent everywhere: irrelevant context and noisy tool choices make it slower and dumber at each individual job.
>
> Outfitter makes the setup a first-class, switchable thing. A profile is YAML composing prompts/context, model + thinking level, skills, extensions, and MCP config. `outfitter -p incident` launches your agent with that loadout; `-p research` swaps the whole thing. Profiles inherit (base → role → project) with deterministic precedence, and catalogs are just git repos, so a team can publish pinned, reviewed loadouts and everyone syncs them.
>
> Honest framing: this is a research preview, about a month old. Pi is the first-class path; the Claude Code adapter is real but behind (no MCP composition yet). Rough edges we know about are in the issue tracker. What we think is actually novel is the compose + launch + git-native-catalog combination — rules-file syncers exist, but nothing that owns the whole loadout and the launch.
>
> Things we'd love takes on: the state-persistence model (per-path symlink/discard/warn/error strategies for what agents write during a run), and whether org-pinned profile catalogs are something your platform team would actually adopt.
>
> Repo: https://github.com/ai-outfitter/outfitter — demo video in the README follows the install to a working session in real time.

Timing: coordinate with the demo video going live; submit on a weekday morning US time; don't ask for votes anywhere.

## (d) Other venues checklist

Priority order. "Verified" = existence checked 2026-07-01; others need a look before submitting.

- [ ] **bradAGI/awesome-cli-coding-agents** — https://github.com/bradAGI/awesome-cli-coding-agents — entry in (a). Verified. Best single listing: exactly the audience, already covers Pi and agent infrastructure.
- [ ] **Pi community Discord** — https://discord.com/invite/nKXTsAcmbT (linked from https://pi.dev) — announcement in (b). Verified. Also ask in-channel how Pi package/extension authors list their packages (README says packages are shared via npm and Discord) and list the Outfitter onboarding extension there.
- [ ] **npm discovery** — https://www.npmjs.com/package/@ai-outfitter/outfitter — not a submission, but the same lever: keywords (`pi`, `coding-agent`, `agent-profiles`, `claude-code`, `mcp`, `cli`) overlap fork issue #27 (differentiation/SEO); make sure they land before the listings drive traffic.
- [ ] **GitHub topics** — on the repo itself: `coding-agents`, `agent-infrastructure`, `pi`, `claude-code`, `mcp`, `developer-tools`. Same rationale; GitHub topic pages are directories too.
- [ ] **hesreallyhim/awesome-claude-code** — https://github.com/hesreallyhim/awesome-claude-code — Verified. Fit is honest only for the Claude adapter; submit under a tooling/orchestrators section **after** Claude parity (M3, fork issues #15–#19) so the listing doesn't overclaim. Check their CONTRIBUTING (they use a structured resource-submission flow, not free-form README edits).
- [ ] **e2b-dev/awesome-ai-agents** — https://github.com/e2b-dev/awesome-ai-agents — broad AI-agents directory; weaker fit (Outfitter is infrastructure, not an agent) but high traffic. Not yet verified; check section fit before submitting.
- [ ] **Terminal Trove** — https://terminaltrove.com — directory of terminal tools with a submission flow; good fit for a terminal-native launcher. Not yet verified; confirm submission process.
- [ ] **MCP directories (mcp.so, PulseMCP, punkpeye/awesome-mcp-servers)** — https://mcp.so, https://www.pulsemcp.com, https://github.com/punkpeye/awesome-mcp-servers — **weak fit today**: Outfitter composes MCP config but is not an MCP server; most of these lists are server-only. Revisit only if an Outfitter MCP server or a clear "MCP tooling" category exists. Not yet verified.
- [ ] **Show HN** — https://news.ycombinator.com/showhn.html — copy in (c); gated on the demo video.
- [ ] **Launch blog post** — on the doc site; canonical home for the demo video + the Show HN narrative; every listing above links back to it or the README.

Acceptance target from the issue: listed in at least two ecosystem directories, announcement posted alongside the demo video.
