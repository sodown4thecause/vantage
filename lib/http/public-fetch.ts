import { isIP } from "node:net";

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      (!url.port || ["80", "443"].includes(url.port)) && host.includes(".") && !isIP(host) &&
      !/\.(localhost|local|internal)$/.test(host);
  } catch { return false; }
}

// Cloudflare's global_fetch_strictly_public also rejects DNS resolving to private networks.
export async function fetchPublicText(
  url: string, init: RequestInit = {}, maxBytes = 64_000,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ response: Response; text: string }> {
  if (!isPublicHttpUrl(url)) throw new Error("A public HTTP(S) URL is required.");
  const timeout = AbortSignal.timeout(4_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const response = await fetchImpl(url, { ...init, redirect: "manual", signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return { response, text: "" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Response exceeds size limit.");
      text += decoder.decode(value, { stream: true });
    }
    return { response, text: text + decoder.decode() };
  } finally { await reader.cancel(); }
}
