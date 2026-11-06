"use server";

import { redirect } from "next/navigation";

import { agentRegistrationEnabled, agentTokenPepper } from "@/lib/agent/config";
import {
  buildErrorRedirect,
  issueAuthorizationCode,
  readAuthorizeRequest,
  validateAuthorizeRequest,
} from "@/lib/agent/oauth/flow";
import { drizzleAgentStore } from "@/lib/agent/oauth/store";
import { safeGetSession } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";

// Consent decision for an agent connection. Every field is re-validated here
// because the hidden inputs are client-controlled. Next.js verifies the request
// origin for server actions, which is the CSRF defence.
export async function decideAuthorization(formData: FormData) {
  if (!agentRegistrationEnabled()) redirect("/");

  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const request = readAuthorizeRequest({
    response_type: field("response_type"),
    client_id: field("client_id"),
    redirect_uri: field("redirect_uri"),
    code_challenge: field("code_challenge"),
    code_challenge_method: field("code_challenge_method"),
    state: field("state"),
    scope: field("scope"),
  });
  if (!request) redirect("/auth-agents");

  const store = drizzleAgentStore();
  const validation = await validateAuthorizeRequest(store, request);
  if (!validation.ok) redirect(validation.redirectTo ?? "/auth-agents");

  if (field("decision") !== "approve") {
    await store.audit({
      event: "authorization_denied",
      clientId: validation.client.id,
      detail: { scopes: validation.scopes },
    });
    redirect(
      buildErrorRedirect(
        request.redirectUri,
        "access_denied",
        "The user declined the request.",
        request.state,
      ),
    );
  }

  const { data: session } = await safeGetSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/auth/sign-in");

  const pepper = agentTokenPepper();
  if (!pepper) redirect("/auth-agents");

  const workspace = await getCurrentWorkspace();
  // A token with no workspace would connect to nothing, so send the user to
  // create one rather than issuing a permanently empty credential.
  if (!workspace) redirect("/onboarding");

  const code = await issueAuthorizationCode(store, {
    clientId: validation.client.id,
    userId: String(userId),
    workspaceId: workspace.id,
    scopes: validation.scopes,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    pepper,
    now: new Date(),
  });
  await store.audit({
    event: "authorization_granted",
    clientId: validation.client.id,
    userId: String(userId),
    workspaceId: workspace.id,
    detail: { scopes: validation.scopes },
  });

  const target = new URL(request.redirectUri);
  target.searchParams.set("code", code);
  if (request.state) target.searchParams.set("state", request.state);
  redirect(target.toString());
}
