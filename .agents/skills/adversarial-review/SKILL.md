---
name: adversarial-review
description: Get an independent review from a different model in a clean context before a PR is marked ready. Use after verify-ui / verify-dataflow have produced evidence.
---
# adversarial-review

The model that built a change will defend its choices again when reviewing. Use a different model with none of the build context.

## Steps
1. **Pick the other model.** Built in Claude Code → review in Codex. Built in Codex → review in Claude Code. Start a **fresh session**.
2. **Give the reviewer only:**
   - the definition of done,
   - the diff: `git diff origin/main...HEAD`,
   - the evidence (screenshots, video, dataflow output).
   Not the builder's plan, chat or reasoning.
3. **Reviewer prompt:**
   > You are an adversarial reviewer. Try to prove this change is NOT done. Check each definition-of-done line against the diff and evidence. Look for: missing workspace scoping or auth, unsafe user URLs, non-idempotent writes, Worker runtime limits (CPU, no long-lived connections), migrations that aren't additive, untested error paths, evidence that doesn't actually show the claim. Report findings as P0/P1/P2 with file:line and a concrete failure scenario. Don't pad with style nits.
4. **Builder answers every finding** in the PR: FIX (with new evidence), REFUTE (with evidence), or DEFER (open an issue). Nothing is silently dropped.
5. Greptile still reviews the PR as a third opinion. It doesn't replace this step.
