---
title: 'Claude adapter: MCP composition'
labels: [enhancement, claude-adapter, m3-claude-parity, plan-2026-07]
size: M
---

## Problem

MCP fragment merging is pi-only (`code/cli/src/compositeProfile/PiMcpConfig.ts`); the Claude composite gets no MCP wiring at all. A profile that declares MCP servers works in pi and silently lacks them in claude — a parity gap in one of the highest-value controls.

## Scope

- Generalize MCP fragment merging out of the pi-specific module.
- Emit merged MCP config into the Claude composite (`CLAUDE_CONFIG_DIR`) in the format Claude Code reads (`.mcp.json` / managed MCP equivalent — verify current claude behavior).
- Layer precedence identical to pi (project-local > project > user > remote).
- Support `cli_specific/claude/` fragments alongside generic ones.

## Acceptance criteria

- A profile with MCP servers launches Claude Code with those servers available.
- Golden-tree integration fixture for the claude composite including MCP output.
- Support matrix updated.

## References

- `code/cli/src/compositeProfile/PiMcpConfig.ts`
- `code/cli/src/agents/ClaudeAdapter.ts:115` (CLAUDE_CONFIG_DIR)
- `docs/archtecture/controllable-elements.md`
