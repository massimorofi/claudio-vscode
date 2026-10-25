---
name: code-review-and-standards
description: Summary of all skills for reviewing code and keeping a codebase clean — coding standards, reviewing pending changes, PR review briefings, deep code review, polish/"impeccable" passes, lint fixing, stacked PR workflows, merging concurrent agent changes and turning tickets into reviewable work. Use when asked to review code or a PR, enforce coding standards, fix lint errors, organize a stack of PRs, merge changes made by multiple agents, or analyze a ticket before implementation.
---

# Code Review, Standards & Change Hygiene

The area of *judging and shipping other people's (or other agents') diffs*.
Every skill here exists because unreviewed, unlinted, badly-sequenced
changes accumulate into an unusable codebase.

## Constituent skills (10)

| Skill | Origin | What it contributes |
|---|---|---|
| coding-standards | built-in | The house style rules the codebase must obey |
| review-changes | built-in | Review of pending/uncommitted changes |
| artifact-pr-review | built-in | Structured PR review briefing published as a shareable page |
| super-code-review | super-* pack | Deep, adversarial code review |
| impeccable | GitHub app | Final polish pass to a high bar |
| fix-lint | built-in | Detect and fix lint violations |
| pr-stack | GitHub app | Stacked PRs: small, dependent, reviewable chain |
| agent-merge | GitHub app | Merging changes produced by multiple concurrent agents |
| commit-push-pr | built-in | Commit → push → open PR as one flow |
| ticket-analyzer | built-in | Parse a ticket into concrete, reviewable scope |

## Consolidated guidance

1. **Review the diff, not the file.** Scope attention to what changed;
   reading whole files invites you to re-litigate code that was already fine.
2. **Standards are written down or they don't exist.** `coding-standards`
   must be explicit (and machine-checked where possible) or every review
   becomes a style argument.
3. **Automate the mechanical, reserve humans for the semantic.** Lint,
   formatting and import order are `fix-lint`'s job. Design, correctness and
   edge cases are the reviewer's job. Never spend a human review on what a
   linter catches.
4. **Small PRs, always.** `pr-stack`: a stack of small dependent PRs beats
   one large one. Each link reviewable on its own; the stack tells the story.
5. **Adversarial review finds real bugs.** `super-code-review` posture:
   assume the diff is wrong and look for the failing input, rather than
   nodding along.
6. **Concurrent agents make merge conflicts, not magic.** `agent-merge`:
   reconcile overlapping edits explicitly; verify the merged result compiles
   and tests pass — a syntactically clean merge can be semantically broken.
7. **Scope before code.** `ticket-analyzer`: convert the ticket into
   checkable acceptance criteria first; ambiguity resolved on paper is
   cheaper than after implementation.
8. **A review you can share beats a review you remember.** Publishing the
   briefing (`artifact-pr-review`) makes the reasoning auditable later.
9. **Polish is a separate pass.** Don't mix `impeccable`-level polish with
   correctness review; they need different attention.

## When to use this skill

"Review this PR/diff", "fix the lint", "enforce our style", "split this
into stacked PRs", "merge what the agents did", "what is this ticket asking?".
