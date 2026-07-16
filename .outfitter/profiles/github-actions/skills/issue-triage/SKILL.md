---
name: issue-triage
description: >-
  Triage one newly opened issue on the Outfitter CLI repository: classify it
  as bug, enhancement, or question, apply that one label, and comment with an
  assessment and a concrete plan grounded in the repository's docs.
references:
  # What Outfitter is and how it's organized — issues are triaged against
  # this. Untrusted repository content.
  - repo_file: README.md
  # Contribution standards and repository structure.
  - repo_file: CONTRIBUTING.md
  # Core concepts: profiles, skills, adapters, catalogs.
  - repo_file: docs/documentation/concepts.md
---

# Issue triage

You are triaging one issue per run. Read `references/README.md` and
`references/concepts.md` first — they define what Outfitter is (a CLI that
composes agent profiles and launches them through adapters like pi and
Claude Code) and the vocabulary issues will use: profiles, skills, controls,
adapters, catalogs.

## Process

1. Take `issue_number` and `issue_author` from the launch prompt's
   trigger_context, then read the issue with `gh issue view <issue_number>`.
2. Classify it as exactly one of:
   - `bug` — existing Outfitter behavior is broken, wrong, or out of date
     (CLI errors, adapter output wrong, docs contradict behavior)
   - `enhancement` — a request for new behavior: a new command, adapter,
     control, profile capability, or docs addition
   - `question` — a request for help or clarification with no change to the
     codebase implied
3. If the classification is clear, apply that one label with
   `gh issue edit <issue_number> --add-label <bug|enhancement|question>`,
   then post one comment (see [Posting the comment](#posting-the-comment))
   containing:
   - a greeting @-mentioning `issue_author`, the classification in a
     sentence, and a short restatement of the request as you understand it,
     in the project's terms (which command, adapter, profile mechanism, or
     doc it touches),
   - for a `bug`: what correct behavior would look like and, if the report
     lacks reproduction steps, Outfitter version, or the agent adapter in
     use, a short bullet list asking the author to add those,
   - for an `enhancement`: a concrete plan as a short numbered list of the
     areas it would touch (CLI command surface, adapter translation, profile
     schema, docs), plus one or two example pseudo-code or YAML blocks
     sketching the shape of the change — labeled clearly as sketches for a
     contributor to adapt, not finished code,
   - for a `question`: a direct answer if the repository's docs contain one,
     with a pointer to the specific doc; otherwise ask a maintainer to
     weigh in,
   - a closing note that a pull request following CONTRIBUTING.md is the way
     to land any change.
4. If you cannot classify it confidently (too vague, contradictory, or
   outside the project's scope as the README describes it), apply no label
   and post one comment asking a maintainer to take a look, naming
   specifically what is unclear.

## Posting the comment

First write the comment text to a file with a quoted heredoc
(`cat <<'EOF' > /tmp/triage-comment.md`), then run
`gh issue comment <number> --body-file /tmp/triage-comment.md`. Never pass
the comment inline with `--body` in double quotes — backticks in the text
would be executed by the shell as commands. The comment only exists if you
actually run `gh issue comment` — never print the comment text as your
answer instead of posting it.

## Hard limits

Only ever apply the labels `bug`, `enhancement`, or `question` — never any
other label and never more than one. Exactly one comment per run. If the
issue already carries one of those three labels, do not change labels; only
comment if you have something material to add, otherwise post nothing and
end the run reporting that the issue was already triaged.
