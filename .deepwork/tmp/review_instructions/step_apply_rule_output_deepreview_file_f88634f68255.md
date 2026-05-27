# Review: step_apply_rule_output_deepreview_file — .deepreview

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


## Step Inputs

- **analysis** (file_path): .deepwork/tmp/README_dependency_analysis.md

Read the dependency analysis from the previous step to verify the rule
faithfully implements the approved plan. Read the documentation file
referenced in the rule's instructions.

Evaluate the output against these criteria:
- Faithful Implementation: The rule accurately implements the dependency analysis from the previous step — same match patterns, same strategy, same rule name convention.
- Effective Instructions: Review instructions clearly tell the reviewer to check whether the documentation file is still accurate given the source file changes. The documentation file path is explicitly referenced. Uses additional_context.unchanged_matching_files: true so the reviewer can read the doc even when only source files changed.


## Files to Review

- .deepreview

## After Review

Report findings with file paths and line references when possible.
If the review passes, call `deepwork_mark_review_as_passed` with review_id `step_apply_rule_output_deepreview_file_f88634f68255`.
Do not mark this review as passed when actionable findings remain.

---

This review was requested by the policy at `/Users/noah/Documents/GitHub/pi/deepwork-pi/standard_jobs/deepwork_reviews/job.yml:0`.
