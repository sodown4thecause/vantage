"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type {
  FieldErrors,
  MonitoringProfileView,
} from "@/lib/profile/types";
import type { FreeScanResult } from "@/lib/lead-magnet/run";

type Props = {
  workspaceId: string;
};

type FreeScanState =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "scanning" }
  | { phase: "done"; result: Extract<FreeScanResult, { ok: true }> }
  | { phase: "queued"; message: string }
  | { phase: "error"; message: string };

type FormState = {
  productUrl: string;
  docsUrlsText: string;
  productDescription: string;
  targetCustomer: string;
  competitorsText: string;
  topicsText: string;
  productMaterialManual: string;
  forceManualMaterial: boolean;
};

const emptyForm: FormState = {
  productUrl: "",
  docsUrlsText: "",
  productDescription: "",
  targetCustomer: "",
  competitorsText: "",
  topicsText: "",
  productMaterialManual: "",
  forceManualMaterial: false,
};

function linesToList(text: string): string[] {
  return text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function profileToForm(profile: MonitoringProfileView): FormState {
  return {
    productUrl: profile.productUrl,
    docsUrlsText: profile.docsUrls.join("\n"),
    productDescription: profile.productDescription,
    targetCustomer: profile.targetCustomer,
    competitorsText: profile.competitors.join("\n"),
    topicsText: profile.topics.join("\n"),
    productMaterialManual:
      profile.productMaterialStatus === "manual"
        ? profile.productMaterialText
        : "",
    forceManualMaterial: profile.productMaterialStatus === "manual",
  };
}

export function OnboardingForm({ workspaceId }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [profile, setProfile] = useState<MonitoringProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [freeScan, setFreeScan] = useState<FreeScanState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const res = await fetch(
          `/api/profile?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: "GET", signal: controller.signal },
        );
        const data = (await res.json().catch(() => ({}))) as {
          profile?: MonitoringProfileView | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Unable to load profile.");
          setProfile(null);
          setLoading(false);
          return;
        }
        if (data.profile) {
          setProfile(data.profile);
          setForm(profileToForm(data.profile));
        } else {
          setProfile(null);
          setForm(emptyForm);
        }
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError("Unable to load profile.");
        setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId]);

  const onChange =
    (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value =
        event.target.type === "checkbox"
          ? (event.target as HTMLInputElement).checked
          : event.target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => {
        const next = { ...prev };
        if (key === "docsUrlsText") delete next.docsUrls;
        else if (key === "competitorsText") delete next.competitors;
        else if (key === "topicsText") delete next.topics;
        else if (key in next) delete next[key as keyof FieldErrors];
        return next;
      });
      setSavedMessage(null);
    };

  const payload = useMemo(
    () => ({
      workspaceId,
      productUrl: form.productUrl,
      docsUrls: linesToList(form.docsUrlsText),
      productDescription: form.productDescription,
      targetCustomer: form.targetCustomer,
      competitors: linesToList(form.competitorsText),
      topics: linesToList(form.topicsText),
      productMaterialManual: form.productMaterialManual,
      forceManualMaterial: form.forceManualMaterial,
    }),
    [form, workspaceId],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        profile?: MonitoringProfileView;
        error?: string;
        fieldErrors?: FieldErrors;
      };
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setError(data.error ?? "Save failed.");
        return;
      }
      if (data.profile) {
        setProfile(data.profile);
        setForm(profileToForm(data.profile));
        setSavedMessage(
          `Saved monitoring profile version ${data.profile.version}.`,
        );
      }
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onRunFreeScan() {
    setError(null);
    setSavedMessage(null);
    setFieldErrors({});
    setFreeScan({ phase: "saving" });

    try {
      const saveRes = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saveData = (await saveRes.json().catch(() => ({}))) as {
        profile?: MonitoringProfileView;
        error?: string;
        fieldErrors?: FieldErrors;
      };
      if (!saveRes.ok) {
        if (saveData.fieldErrors) setFieldErrors(saveData.fieldErrors);
        setFreeScan({ phase: "error", message: saveData.error ?? "Save failed." });
        return;
      }
      if (saveData.profile) {
        setProfile(saveData.profile);
        setForm(profileToForm(saveData.profile));
      }

      setFreeScan({ phase: "scanning" });
      const scanRes = await fetch("/api/lead-magnet/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const scanData = (await scanRes.json().catch(() => ({}))) as FreeScanResult | { error?: string };

      if (!scanRes.ok || !("ok" in scanData) || !scanData.ok) {
        const message =
          "message" in scanData && typeof scanData.message === "string"
            ? scanData.message
            : ("error" in scanData && typeof scanData.error === "string"
              ? scanData.error
              : "The free scan could not be completed.");
        const queued = "reason" in scanData && (scanData.reason === "per_user_limit" || scanData.reason === "budget_exhausted");
        setFreeScan(queued ? { phase: "queued", message } : { phase: "error", message });
        return;
      }
      setFreeScan({ phase: "done", result: scanData });
    } catch {
      setFreeScan({ phase: "error", message: "The free scan could not be completed." });
    }
  }

  const scanBusy = freeScan.phase === "saving" || freeScan.phase === "scanning";

  if (loading) {
    return (
      <p className="text-sm text-zinc-500" data-testid="onboarding-loading">
        Loading profile…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="onboarding-form">
      {profile ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Current version <strong>v{profile.version}</strong> · material{" "}
          <code className="rounded bg-white/70 px-1 dark:bg-black/30">
            {profile.productMaterialStatus}
          </code>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          No profile yet — describe your product to create version 1.
        </div>
      )}

      <Field
        label="Product URL"
        error={fieldErrors.productUrl}
        htmlFor="productUrl"
      >
        <input
          id="productUrl"
          name="productUrl"
          type="url"
          required
          value={form.productUrl}
          onChange={onChange("productUrl")}
          className={inputClass}
          placeholder="https://example.com"
        />
      </Field>

      <Field
        label="Docs / README URLs (one per line)"
        error={fieldErrors.docsUrls}
        htmlFor="docsUrls"
      >
        <textarea
          id="docsUrls"
          name="docsUrls"
          rows={3}
          value={form.docsUrlsText}
          onChange={onChange("docsUrlsText")}
          className={inputClass}
          placeholder="https://example.com/docs"
        />
      </Field>

      <Field
        label="Product description"
        error={fieldErrors.productDescription}
        htmlFor="productDescription"
      >
        <textarea
          id="productDescription"
          name="productDescription"
          rows={4}
          required
          value={form.productDescription}
          onChange={onChange("productDescription")}
          className={inputClass}
          placeholder="What does the product do?"
        />
      </Field>

      <Field
        label="Target customer"
        error={fieldErrors.targetCustomer}
        htmlFor="targetCustomer"
      >
        <textarea
          id="targetCustomer"
          name="targetCustomer"
          rows={2}
          required
          value={form.targetCustomer}
          onChange={onChange("targetCustomer")}
          className={inputClass}
          placeholder="Who is this for?"
        />
      </Field>

      <Field
        label="Competitors (3–5, one per line)"
        error={fieldErrors.competitors}
        htmlFor="competitors"
      >
        <textarea
          id="competitors"
          name="competitors"
          rows={4}
          required
          value={form.competitorsText}
          onChange={onChange("competitorsText")}
          className={inputClass}
          placeholder={"Competitor A\nCompetitor B\nCompetitor C"}
        />
      </Field>

      <Field
        label="Important topics / problems (one per line)"
        error={fieldErrors.topics}
        htmlFor="topics"
      >
        <textarea
          id="topics"
          name="topics"
          rows={3}
          required
          value={form.topicsText}
          onChange={onChange("topicsText")}
          className={inputClass}
          placeholder={"pricing objections\nonboarding friction"}
        />
      </Field>

      <div className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          <input
            type="checkbox"
            checked={form.forceManualMaterial}
            onChange={onChange("forceManualMaterial")}
          />
          Supply product material manually (skip URL fetch)
        </label>
        <Field
          label="Manual product material"
          error={fieldErrors.productMaterialManual}
          htmlFor="productMaterialManual"
        >
          <textarea
            id="productMaterialManual"
            name="productMaterialManual"
            rows={5}
            value={form.productMaterialManual}
            onChange={onChange("productMaterialManual")}
            className={inputClass}
            placeholder="Paste README / positioning when the site is inaccessible."
          />
        </Field>
        {profile?.retrievalNotes ? (
          <p className="text-xs text-zinc-500" data-testid="retrieval-notes">
            Last retrieval: {profile.retrievalNotes}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {savedMessage ? (
        <div className="space-y-3">
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {savedMessage}
        </p>
        <Link href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`} className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm text-white">Continue to opportunity queue</Link>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-6 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {saving ? "Saving…" : "Save monitoring profile"}
      </button>

      <FreeScanCta
        busy={scanBusy}
        disabled={saving}
        state={freeScan}
        onRun={onRunFreeScan}
      />

      {freeScan.phase === "done" ? (
        <FreeScanResults workspaceId={workspaceId} result={freeScan.result} />
      ) : null}
    </form>
  );
}

function FreeScanCta({
  busy,
  disabled,
  state,
  onRun,
}: {
  busy: boolean;
  disabled: boolean;
  state: FreeScanState;
  onRun: () => void;
}) {
  const label = busy
    ? state.phase === "saving"
      ? "Saving profile…"
      : "Running your free basic scan…"
    : "Run my free first scan";
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Free basic scan
      </p>
      <p className="text-xs text-zinc-500">
        Saves your profile, provisions sources, then scans Hacker News, RSS and
        Substack once. One scan per day on the free plan.
      </p>
      <button
        type="button"
        onClick={onRun}
        disabled={busy || disabled}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
        data-testid="run-free-scan"
      >
        {label}
      </button>
      {busy ? (
        <p role="status" className="text-xs text-zinc-500" data-testid="free-scan-progress">
          {state.phase === "saving"
            ? "Saving profile and provisioning sources…"
            : "Collecting free sources, then ranking opportunities…"}
        </p>
      ) : null}
      {state.phase === "queued" ? (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300" data-testid="free-scan-queued">
          {state.message}
        </p>
      ) : null}
      {state.phase === "error" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400" data-testid="free-scan-error">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function FreeScanResults({
  workspaceId,
  result,
}: {
  workspaceId: string;
  result: Extract<FreeScanResult, { ok: true }>;
}) {
  const queueHref = `/queue?workspaceId=${encodeURIComponent(workspaceId)}`;
  return (
    <section className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800" data-testid="free-scan-results">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {result.label}
        </h2>
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">
          {result.message}
        </p>
        <p className="text-xs text-zinc-500" data-testid="free-scan-sources">
          Sources used: {result.sourcesUsed.length ? result.sourcesUsed.join(", ") : "none"}
        </p>
      </div>

      {result.cards.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300" data-testid="free-scan-empty">
          No strong opportunities yet — we&apos;ll keep watching and refresh your
          queue.{" "}
          <Link href={queueHref} className="link">
            Open the queue
          </Link>
          .
        </div>
      ) : (
        <>
          <ol className="space-y-3" data-testid="free-scan-cards">
            {result.cards.slice(0, 5).map((card) => (
              <li key={card.id} className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <Link
                  href={`/opportunities/${card.id}?workspaceId=${encodeURIComponent(workspaceId)}`}
                  className="link block text-base font-semibold leading-snug"
                >
                  {card.title}
                </Link>
                <p className="mt-1 text-xs text-zinc-500">
                  Score {card.score.toFixed(2)} · Confidence {card.confidence.toFixed(2)} ·{" "}
                  {card.evidenceCount} {card.evidenceCount === 1 ? "post" : "posts"}
                </p>
              </li>
            ))}
          </ol>
          <Link
            href={queueHref}
            className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm text-white"
          >
            Open the full queue
          </Link>
        </>
      )}
    </section>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm outline-none ring-zinc-400 placeholder:text-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-zinc-900 dark:text-zinc-50"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
