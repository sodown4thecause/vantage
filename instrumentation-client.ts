import posthog from "posthog-js";

import { isReplayExcludedPath, posthogKey, replayEnabled } from "@/lib/analytics/config";

const key = posthogKey();

if (key) {
  posthog.init(key, {
    api_host: "/ingest",
    defaults: "2026-08-30",
    // Anonymous visitors stay anonymous; a person profile exists only after identify on sign-in.
    person_profiles: "identified_only",
    // Honour the browser's Do Not Track setting: nothing is captured or recorded when it is on.
    respect_dnt: true,
    // Uncaught errors and unhandled rejections become error-tracking exceptions linked to the replay.
    capture_exceptions: true,
    capture_performance: true,
    advanced_disable_feature_flags: false,
    disable_session_recording: !replayEnabled() || isReplayExcludedPath(window.location.pathname),
    session_recording: {
      // Every input and textarea (draft and reply text, search boxes, sign-in fields) is masked.
      maskAllInputs: true,
      // Customer conversations, posts and drafts render as ordinary text, so all text is masked by default.
      // Replays show layout, clicks, errors and network failures, never customer words.
      maskTextSelector: "*",
      blockClass: "ph-no-capture",
    },
  });
}

export function onRouterTransitionStart(url: string) {
  if (!key || !replayEnabled() || !posthog.__loaded) return;
  const { pathname } = new URL(url, window.location.origin);
  if (isReplayExcludedPath(pathname)) posthog.stopSessionRecording();
  else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
}
