"use client";

import { useState } from "react";

import { draftText, FIELD_LABELS, PROFILE_FIELDS, type ProfileDraft, type ProfileField } from "@/lib/onboarding/draft";
import type { InterviewAnswers } from "@/lib/onboarding/interview";

import s from "./profile-draft-card.module.css";

const HINTS: Partial<Record<ProfileField, string>> = {
  competitors: "Three to five, separated by commas.",
  communities: "Optional. Subreddits, forums or groups, separated by commas.",
  keywords: "Problems in your customer’s words, separated by commas.",
};

/**
 * The profile derived from the owner's website, one editable field each. "Confirm" saves one field; "Looks right"
 * saves every field still open. Confirmed fields are stored, so a returning owner picks up at the first open one.
 */
export function ProfileDraftCard({ draft, answers, busy, onConfirm }: {
  draft: ProfileDraft;
  answers: InterviewAnswers;
  busy: boolean;
  onConfirm: (values: Partial<Record<ProfileField, string>>) => void;
}) {
  const [values, setValues] = useState<Record<ProfileField, string>>(() => Object.fromEntries(
    PROFILE_FIELDS.map((field) => [field, draftText(draft[field])]),
  ) as Record<ProfileField, string>);
  const open = PROFILE_FIELDS.filter((field) => answers[field] === undefined);
  const firstOpen = open[0];

  return <section className={s.card} aria-labelledby="profile-draft-heading">
    <div className={s.head}><h2 id="profile-draft-heading">Your product profile</h2><span>{PROFILE_FIELDS.length - open.length} of {PROFILE_FIELDS.length} confirmed</span></div>
    {PROFILE_FIELDS.map((field) => {
      const id = `profile-${field}`;
      const confirmed = answers[field];
      if (confirmed !== undefined) {
        return <div key={field} className={s.field}>
          <div className={s.label}><span>{FIELD_LABELS[field]}</span><span className={s.done}>✓ Confirmed</span></div>
          <p className={s.confirmed}>{draftText(confirmed as string | string[]) || "None"}</p>
        </div>;
      }
      const Input = field === "productDescription" || field === "targetCustomer" ? "textarea" : "input";
      return <div key={field} className={s.field}>
        <div className={s.label}>
          <label htmlFor={id}>{FIELD_LABELS[field]}</label>
          <button type="button" className={s.small} disabled={busy} onClick={() => onConfirm({ [field]: values[field] })}>Confirm</button>
        </div>
        <Input id={id} value={values[field]} disabled={busy} autoFocus={field === firstOpen} maxLength={field === "productDescription" || field === "targetCustomer" ? 8000 : 2000}
          onChange={(event) => setValues({ ...values, [field]: event.target.value })} />
        {HINTS[field] && <span className={s.hint}>{HINTS[field]}</span>}
      </div>;
    })}
    <div className={s.footer}>
      <span className={s.hint}>Nothing is saved until you confirm.</span>
      <button type="button" className={s.primary} disabled={busy || open.length === 0}
        onClick={() => onConfirm(Object.fromEntries(open.map((field) => [field, values[field]])))}>Looks right</button>
    </div>
  </section>;
}
