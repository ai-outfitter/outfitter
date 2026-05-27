# Review: step_add_language_reviews_output_deepreview_files — .deepreview

## Project Root

/Users/noah/Documents/GitHub/bridl

Read files from this project root using Pi file-reading tools, even if your current working directory differs.

## Review Instructions

## Job Context

This job manages .deepreview configuration files, which define automated code review
rules for DeepWork Reviews. Reviews are triggered when files matching specified glob
patterns change in a PR or commit.

For the .deepreview file format, key concepts, and rule naming conventions, read
`deepreview_reference.md` (relative to this job's directory).


For each language review rule, read the convention file it references
and verify the review instructions make sense for that language. Check
that every rule uses strategy: individual.

Evaluate the output against these criteria:
- Convention Files Sensible: Each language convention file is concise, actionable, and based on actual project patterns — not generic boilerplate. If pre-existing standards files exist, they are referenced rather than duplicated.
- Per-File Strategy: Every language review rule uses strategy: individual. No language review rule uses matches_together or all_changed_files.
- DRY and Comment Checks: Every language review rule's instructions explicitly include checks for DRY violations (duplicated logic, repeated patterns) and comment accuracy (comments still match the code after changes).
- Correct Match Patterns: Match patterns correctly target the language's file extensions with appropriate excludes for generated/vendor files.


## Files to Review

- .deepreview

## After Review

Report findings with file paths and line references when possible.
If the review passes, call `deepwork_mark_review_as_passed` with review_id `step_add_language_reviews_output_deepreview_files_b8ecb1b91dd3`.
Do not mark this review as passed when actionable findings remain.

---

This review was requested by the policy at `/Users/noah/Documents/GitHub/pi/deepwork-pi/standard_jobs/deepwork_reviews/job.yml:0`.
