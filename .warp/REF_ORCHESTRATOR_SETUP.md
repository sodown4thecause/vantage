# Ref as planner/orchestrator for Warp Oz

Goal: **Ref Plans is the control plane**. Warp Oz agents are workers that
Ref launches, steers, and collects results from.

## Architecture

```
Ref Plans (orchestrator)
  │  LaunchAgent harness=warp-oz
  │  SendMessage / status tracking
  ▼
Warp Oz cloud agent  (environment: Vantage / gxWqjwR1T4PADxzGeroSQ6)
  │  implements task, opens PR
  │  ref-plan MCP: Read / Edit / SendMessage / PrLinks
  ▼
GitHub PR + plan updates back in Ref
```

## One-time setup (required)

### 1. Warp → Ref (launch path)

In **Ref Plans → Settings → Agents → Warp OZ**:

1. Paste a **fresh team Warp API key** (starts with `wk-1.`).
2. Set **Environment ID** to:

   `gxWqjwR1T4PADxzGeroSQ6`

   (name: **Vantage**, description: Ref connection, image `node:22-bookworm`,
   repo `sodown4thecause/vantage`)

   Alternate env id: `8NdBITBF0BKKto37KT2Ftb` (`vantage`).

3. Save. Do **not** leave Environment ID blank while debugging.

If launches fail with `resource wk-1.… not found`, the key Ref stored is
stale/wrong — create a new Warp API key and replace it in Ref.

### 2. Ref → Warp agents (callback path)

So Oz workers can talk to the Ref orchestrator, attach Ref Plans MCP on runs:

- Project file: `.warp/.mcp.json`
- Cloud agent config: `.warp/ref-orchestrated-agent.json`
- CLI mcp file: `.warp/ref-mcp.json`

Provide `REF_API_KEY` (from https://ref.tools/keys) via:

- Agent Secret named `REF_API_KEY`, or
- export before `oz agent run-cloud`

Example:

```bash
export REF_API_KEY='ref-…'
oz agent run-cloud \
  --environment gxWqjwR1T4PADxzGeroSQ6 \
  -f .warp/ref-orchestrated-agent.json \
  --prompt 'Implement Task 1 from plan B66sIZ4yHGIRNqjZ'
```

### 3. Ref Factory / orchestration settings

In Ref: enable agent orchestration / Factory settings and the **warp-oz** harness.

### 4. Optional local harness

Pair a device with `capabilities.launch: true` in `~/.ref/config.json` for
`LaunchAgent` harness `local` as a fallback when cloud launch is blocked.

## Orchestrator powers (Ref side)

| Tool | Role |
|------|------|
| `Read` / `Edit` / `Write` | Plan of record |
| `LaunchAgent` (`warp-oz`) | Spawn Oz workers |
| `SendMessage` | Steer children / receive completion |
| `ListDevices` | Local launch targets |
| `PrLinks` | Attach PRs to the plan |
| `Comments` | Human review loop |

Workers **must** `SendMessage` parent on done/blocked with PR URL when applicable.

## Verify

1. From Ref: LaunchAgent Task 1 → status Working (not resource-not-found).
2. In Oz run: ref-plan tools available; agent can Read plan `B66sIZ4yHGIRNqjZ`.
3. On finish: PR linked on plan via PrLinks + parent message.
