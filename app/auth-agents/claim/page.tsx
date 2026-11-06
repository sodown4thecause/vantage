import { AuthView } from "@neondatabase/auth-ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHead, Shell } from "@/components/shell";
import { agentRegistrationEnabled } from "@/lib/agent/config";
import { drizzleRegistrationStore } from "@/lib/agent/registration";
import { safeGetSession } from "@/lib/auth/server";
import { getCurrentWorkspace } from "@/lib/auth/workspace";

import { completeClaimAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_code: "That code is not right. Check the six digits and try again.",
  expired: "That code has expired. Ask the agent for a new one.",
  already_claimed: "This workspace has already been claimed.",
  email_mismatch: "This claim was started for a different email address.",
  too_many_attempts: "Too many wrong codes. Ask the agent for a new one.",
  not_found: "This claim link is not valid. Ask the agent to start again.",
};

// The human half of the claim ceremony: sign in, type the six-digit code the
// agent showed, and the trial workspace becomes theirs.
export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!agentRegistrationEnabled()) notFound();

  const params = await searchParams;
  const attemptId = typeof params.attempt === "string" ? params.attempt.trim() : "";
  const error = typeof params.error === "string" ? params.error : "";
  if (!attemptId) {
    return (
      <Shell wide>
        <PageHead
          title="Claim a workspace"
          lede="This link is missing its claim reference. Ask the agent to start again."
        />
      </Shell>
    );
  }

  const { data: session } = await safeGetSession();
  if (!session?.user?.id) {
    return (
      <Shell wide>
        <PageHead
          title="Sign in to claim this workspace"
          lede="An AI agent started a Vantage trial. Sign in to make it yours."
        />
        <div className="max-w-md">
          <AuthView path="sign-in" redirectTo={`/auth-agents/claim?attempt=${attemptId}`} />
        </div>
      </Shell>
    );
  }

  const attempt = await drizzleRegistrationStore().findClaimAttempt(attemptId);
  if (!attempt) {
    return (
      <Shell wide>
        <PageHead title="Claim a workspace" lede={ERRORS.not_found!} />
      </Shell>
    );
  }

  const existing = await getCurrentWorkspace();
  if (existing) {
    return (
      <Shell wide>
        <PageHead
          title="You already have a workspace"
          lede="A trial can only be claimed by an account with no workspace yet. Merging a trial into an existing workspace is not available."
        />
        <Link href={`/queue?workspaceId=${encodeURIComponent(existing.id)}`} className="btn">
          Go to your queue
        </Link>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <PageHead
        title="Claim this workspace"
        lede="Enter the six-digit code the agent gave you. The trial workspace moves onto your account."
      />
      <div className="max-w-md space-y-4">
        {error ? (
          <p className="text-stop" role="alert">
            {ERRORS[error] ?? "That did not work. Try again."}
          </p>
        ) : null}
        <form action={completeClaimAction} className="space-y-4">
          <input type="hidden" name="attempt" value={attemptId} />
          <label className="block space-y-1">
            <span className="font-semibold">Six-digit code</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className="w-full rounded-lg border border-contour bg-sheet px-3 py-2 text-sm text-ink"
            />
          </label>
          <button type="submit" className="btn">
            Claim workspace
          </button>
        </form>
      </div>
    </Shell>
  );
}
