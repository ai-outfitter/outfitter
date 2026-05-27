# Review: step_migrate_existing_skills_process_quality — .deepreview

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


## Process Requirements Review

Please review for compliance with the following requirements. You MUST fail the review for any requirement using MUST/SHALL that is not met. You MUST fail the review for any SHOULD/RECOMMENDED requirement that appears easily achievable but was not followed. You SHOULD give feedback but not fail the review for any other applicable requirements.

## Requirements

- **Replacement Rules Capture Skill Intent**: Every migrated skill MUST have a corresponding .deepreview rule whose instructions faithfully capture the original skill's review logic. No significant review checks MUST be missing. The backup skill files are reference material only — do not give feedback on them, only use them to verify the new rules are complete.

- **Replacement Rule Match Patterns Appropriate**: The match.include patterns in each new .deepreview rule MUST target the same file types and scopes that the original skill was designed to review. Patterns MUST NOT be too broad or too narrow.


## Work Summary (work_summary)

Searched the project for project-owned skill definitions under skill directories/SKILL.md; no review-like project skills were present, so no migration or backups were needed.

## Step Outputs

- **deepreview_files**: .deepreview
- **migrated_skill_backups**: 

Evaluate whether the work described in the work_summary meets each requirement. If an output file helps verify a requirement, read it.

## Files to Review

- .deepreview

## After Review

Report findings with file paths and line references when possible.
If the review passes, call `deepwork_mark_review_as_passed` with review_id `step_migrate_existing_skills_process_quality_817b9461c3fe`.
Do not mark this review as passed when actionable findings remain.

---

This review was requested by the policy at `/Users/noah/Documents/GitHub/pi/deepwork-pi/standard_jobs/deepwork_reviews/job.yml:0`.
