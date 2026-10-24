import posthog from "posthog-js";

import { isReplayExcludedPath, posthogHost, posthogKey } from "@/lib/analytics/config";

const key = posthogKey();

if (key) {
  posthog.init(key, {
    api_host: posthogHost(),
    defaults: "2026-08-30",
    // Anonymous visitors stay anonymous; a person profile exists only after identify on sign-in.
    person_profiles: "identified_only",
    // Honour the browser's Do Not Track setting: nothing is captured or recorded when it is on.
    respect_dnt: true,
    // Uncaught errors and unhandled rejections become error-tracking exceptions linked to the replay.
    capture_exceptions: true,
    disable_session_recording: isReplayExcludedPath(window.location.pathname),
    session_recording: {
      // Every input and textarea (draft and reply text, search boxes, sign-in fields) is masked.
      maskAllInputs: true,
      // Text rendered from user content (drafts, posts, replies) opts in with the ph-mask class.
      maskTextClass: "ph-mask",
      blockClass: "ph-no-capture",
    },
  });
}

export function onRouterTransitionStart(url: string) {
  if (!key || !posthog.__loaded) return;
  const { pathname } = new URL(url, window.location.origin);
  if (isReplayExcludedPath(pathname)) posthog.stopSessionRecording();
  else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
}
