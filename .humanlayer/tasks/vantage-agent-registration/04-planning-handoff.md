# Planning handoff and checks

**1 November 2026 · no application implementation; await Liam's OK.**

GitHub issue **#178** was created and read back successfully:
https://github.com/sodown4thecause/vantage/issues/178
Both existing labels are present: `agent-ready`, `vertical-slice`. The published
body matches the locally retained issue text. No assignment, board change,
merge, PR or deployment was performed. The proposed plan is AR00–AR05; approve
AR00 first, then review its compatibility decision before later implementation.

Real local HumanLayer task: `01a194dd-2016-75c5-9172-3ab3ae53e723`.
Existing daemon/CLI reused; Shelley remains a manual phase/artifact adaptation.
No native coding session or cloud web-UI synchronisation is asserted.

Local planning checks:
- Markdown local links, JSON parsing, referenced repository paths and all 17
  downloaded primary-source snapshot SHA-256 values checked.
- Remote main's actual migration list and journal checked: 0035 / index 35 at
  84fe2c9. No new migration generated or applied; recheck main at implementation.
- New task files and the branch comparison summary reviewed; whitespace check
  passed. Prior readiness work remains separate from this planning increment.
- No lint, typecheck, app/Worker build, unit/dataflow/client/OAuth/registration or
  staging walkthrough run in this documentation-only turn. Earlier readiness
  results are not new validation of this feature.

The planning checkout predates newer main commits. Its combined main comparison
contains earlier readiness work and differences introduced on main, not just
this task. Do not use that combined diff as an implementation PR: start each
approved slice from refreshed main, recheck current code and bring only explicit
dependencies. This commit adds only the six task planning files.

No secrets/environment values/bindings configured, dependencies installed,
external source code adopted, Vantage workspace/account created, emails sent, paid
provider calls or production changes. Existing off-VM GitHub integration was
used through its documented GH_HOST without adding a token to the VM.

Client zero is contextfor.dev. Public case-study evidence must distinguish
planned, locally tested, staging-tested and production-shipped functionality;
redact credentials, claim codes, private context and other users' data. A real
staging hostname is required for the new flow; using the public product domain
as research input is not production activation permission.
