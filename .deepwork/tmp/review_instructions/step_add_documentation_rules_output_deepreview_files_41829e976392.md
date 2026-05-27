# Review: step_add_documentation_rules_output_deepreview_files — .deepreview

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


Read all .deepreview files together along with the documentation files their
rules protect. The criteria below are cross-cutting — Documentation Covered
and Efficient Rule Count require a project-wide view of all rules at once,
which is why this review runs once over the full set rather than per file.

Evaluate the output against these criteria:
- Documentation Covered: Every project documentation file that describes the project itself has a corresponding rule (either newly created or pre-existing).
- Trigger Scope Minimal: Each rule's match.include patterns are as narrow as possible while still catching changes that could affect the protected documentation. Rules are not overly broad (e.g., matching all files when only a specific directory matters).
- Efficient Rule Count: Where multiple narrow rules have substantially overlapping triggers, they have been merged into shared rules. The total number of rules is the minimum needed for adequate coverage. Separate narrow rules are only used when their trigger sets are genuinely disjoint.


## Files to Review

- .deepreview

## After Review

Report findings with file paths and line references when possible.
If the review passes, call `deepwork_mark_review_as_passed` with review_id `step_add_documentation_rules_output_deepreview_files_41829e976392`.
Do not mark this review as passed when actionable findings remain.

---

This review was requested by the policy at `/Users/noah/Documents/GitHub/pi/deepwork-pi/standard_jobs/deepwork_reviews/job.yml:0`.
