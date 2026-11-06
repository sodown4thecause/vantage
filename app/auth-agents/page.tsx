import { AuthView } from "@neondatabase/auth-ui";
import { notFound } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { agentRegistrationEnabled } from "@/lib/agent/config";
import { readAuthorizeRequest, validateAuthorizeRequest } from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { safeGetSession } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";

import { decideAuthorization } from "./actions";

export const dynamic = "force-dynamic";

const SCOPE_COPY: Record<string, string> = {
  "vantage.read":
    "Read your workspace context, today's ranked conversations and the posts behind them.",
  "vantage.draft": "Draft a reply as text. Nothing is saved, sent or posted.",
};

// Human-facing entry for agent connections: the OAuth consent screen, and the
// sign-in form when the visitor is signed out. Signing in refreshes this route,
// so the consent form appears without losing the authorization request.
export default async function AuthAgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!agentRegistrationEnabled()) notFound();

  const request = readAuthorizeRequest(await searchParams);
  if (!request) {
    return (
      <Shell wide>
        <PageHead
          title="Agent connection"
          lede="This link is missing required parameters. Ask the agent to start again."
        />
      </Shell>
    );
  }

  const validation = await validateAuthorizeRequest(drizzleAgentStore(), request);
  if (!validation.ok) {
    return (
      <Shell wide>
        <PageHead title="Agent connection" lede={validation.description} />
      </Shell>
    );
  }

  const { data: session } = await safeGetSession();
  if (!session?.user?.id) {
    return (
      <Shell wide>
        <PageHead
          title="Sign in to connect an agent"
          lede={`${validation.client.name} wants to read your Vantage workspace. Sign in or create an account to continue.`}
        />
        <div className="max-w-md">
          <AuthView path="sign-in" />
        </div>
      </Shell>
    );
  }

  const workspace = await getCurrentWorkspace();

  return (
    <Shell wide>
      <PageHead
        title={`Connect ${validation.client.name}?`}
        lede="An AI agent is asking for access to your Vantage workspace."
      />
      <div className="max-w-xl space-y-6">
        <ul className="space-y-2 border-t border-contour pt-6">
          {validation.scopes.map((scope) => (
            <li key={scope}>
              <strong>{scope}</strong> — {SCOPE_COPY[scope] ?? "No description."}
            </li>
          ))}
        </ul>
        <p className="text-ridge">
          Vantage never posts, replies or messages anyone. This agent can read and draft only.
        </p>
        <p className="text-ridge">
          {workspace ? (
            <>
              Workspace: <strong className="text-ink">{workspace.name}</strong>
            </>
          ) : (
            "You have no workspace yet. The agent will see an empty workspace until you create one."
          )}
        </p>
        <form action={decideAuthorization} className="flex flex-wrap gap-3">
          <input type="hidden" name="response_type" value={request.responseType} />
          <input type="hidden" name="client_id" value={request.clientId} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="code_challenge" value={request.codeChallenge} />
          <input type="hidden" name="code_challenge_method" value={request.codeChallengeMethod} />
          <input type="hidden" name="state" value={request.state ?? ""} />
          <input type="hidden" name="scope" value={request.scope ?? ""} />
          <button type="submit" name="decision" value="approve" className="btn">
            Allow access
          </button>
          <button type="submit" name="decision" value="deny" className="btn">
            Cancel
          </button>
        </form>
      </div>
    </Shell>
  );
}
