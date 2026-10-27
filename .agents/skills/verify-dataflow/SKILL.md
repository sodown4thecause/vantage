---
name: verify-dataflow
description: Prove a backend change works by pushing realistic input through the whole Vantage dataflow with a throwaway script and printing what lands at each hop. Use for collectors, scoring, queues, Workflows, cron, digest, DB and API changes.
---
# verify-dataflow

Done for backend work means real-shaped data went in one end and the right thing came out the other, and you printed every hop.

## Steps
1. **Map the flow the change touches**, e.g. source → collector → normalise → score → store (workspace-scoped) → queue → digest/email. Write the hops down before coding the script.
2. **Write a throwaway script** in `scripts/scratch/<branch>-<slug>.ts` (gitignored). Run with `pnpm tsx scripts/scratch/<file>.ts`. It should:
   - feed one realistic input (a recorded provider payload or fixture marked `metadata.mocked`),
   - call the real code paths, not re-implementations,
   - print the state after each hop (row ids, scores, status, the digest payload),
   - assert the definition-of-done lines and exit non-zero on failure.
3. **Use a safe database.** A Neon branch (see `.agents/skills/neon`) or staging. Never the production `DATABASE_URL`.
4. **Prove the boundary.** Run once with a second workspace and show its data does not appear.
5. **Run twice** to show it is idempotent (no duplicate rows, no duplicate emails).
6. **Report:** the command, the printed output per hop, and pass/fail per definition-of-done line.
7. **Keep what found bugs.** If the script caught a real bug, turn that case into a permanent test under `test/`. Delete the rest.

## Rules
- No live posting, no real outbound email (use test recipients), no paid provider calls in loops. Use recorded payloads where you can.
- Never print secrets or full connection strings in output that goes on a PR.
