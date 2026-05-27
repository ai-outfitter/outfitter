# Review: suggest_new_reviews — .deepreview

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

## Job Context

This job manages .deepreview configuration files, which define automated code review
rules for DeepWork Reviews. Reviews are triggered when files matching specified glob
patterns change in a PR or commit.

For the .deepreview file format, key concepts, and rule naming conventions, read
`deepreview_reference.md` (relative to this job's directory).


## Step Inputs

- **analysis** (file_path): .deepwork/tmp/README_dependency_analysis.md

This review is being run as a DeepWork workflow quality gate for job 'deepwork_reviews', workflow 'add_document_update_rule', step 'apply_rule'.

## Work Summary

Added update_readme to .deepreview from the approved README.md dependency analysis. The rule watches README.md, recommendation.md, package.json, tsconfig.json, src/**/*.ts, and bin/**/*.ts, uses matches_together, and includes unchanged matching files for documentation freshness review.

Analyze the changeset to determine whether any new DeepWork review rules
should be added.

1. Call get_configured_reviews to see all currently configured review rules.
2. Read README_REVIEWS.md if present for context on review capabilities.
3. For each change, consider:
   - Did this change introduce a type of issue a review rule could catch?
   - Is there a pattern likely to recur?
   - Would an existing rule benefit from a small scope expansion?
4. Be extremely conservative. Only suggest rules that are:
   - Extremely narrow (targets 1 specific file or small bounded set)
   - Slight additions to existing rules (adding a glob to an include list)
   - Catches an issue likely to recur and worth ongoing cost
5. If no rules are warranted, say so. An empty suggestion list is valid.

## Files to Review

Use Pi's file-reading tools to inspect these paths under the Project Root. Do not rely on Claude-specific @path auto-read behavior.

- .deepreview

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"suggest_new_reviews--.deepreview--16b9b7fa8c3c"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepreview:58`.
