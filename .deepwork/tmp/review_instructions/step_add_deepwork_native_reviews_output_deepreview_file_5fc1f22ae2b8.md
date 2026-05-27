# Review: step_add_deepwork_native_reviews_output_deepreview_file — .deepreview

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


Verify the .deepreview file contains both native review rules with correct configuration.

Evaluate the output against these criteria:
- prompt_best_practices Rule Present: The .deepreview file contains a prompt_best_practices rule with strategy: individual and match patterns that cover prompt/instruction markdown files in the project.
- suggest_new_reviews Rule Present: The .deepreview file contains a suggest_new_reviews rule with strategy: matches_together and broad match patterns covering project files.


## Files to Review

- .deepreview

## After Review

Report findings with file paths and line references when possible.
If the review passes, call `deepwork_mark_review_as_passed` with review_id `step_add_deepwork_native_reviews_output_deepreview_file_5fc1f22ae2b8`.
Do not mark this review as passed when actionable findings remain.

---

This review was requested by the policy at `/Users/noah/Documents/GitHub/pi/deepwork-pi/standard_jobs/deepwork_reviews/job.yml:0`.
