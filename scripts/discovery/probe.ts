import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Agent, fetch } from "undici";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const parts = address.toLowerCase().split(":");
  const first = parseInt(parts[0], 16);
  const second = parseInt(parts[1] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && first !== 0x3fff;
}

export async function publicDns(host: string, resolve = lookup) {
  const addresses = await resolve(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Unsafe discovery DNS");
  return addresses;
}

export async function publicTarget(value: string, resolve = lookup): Promise<URL> {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) || !host.includes(".") ||
    isIP(host) || /\.(local|localhost|internal|test|invalid)$/.test(host)) throw new Error("Unsafe discovery URL");
  await publicDns(host, resolve);
  url.hash = "";
  return url;
}

export type Probe = { url: string; final_url: string; status: number | null; result: "yes" | "unknown"; checked_at: string; requests: number };

export function createProbe(cacheDir: string, online: boolean) {
  let lastStart = 0;
  let requests = 0;
  const agent = new Agent({ connect: { lookup(hostname, options, callback) {
    publicDns(hostname).then(addresses => {
      const selected = addresses[0];
      if (options.all) callback(null, addresses);
      else callback(null, selected.address, selected.family);
    }).catch(error => callback(error, "", 4));
  } } });
  return {
    get requests() { return requests; },
    close: () => agent.close(),
    async check(value: string): Promise<Probe | null> {
      const key = createHash("sha256").update(value).digest("hex");
      const path = join(cacheDir, `${key}.json`);
      try {
        const cached = JSON.parse(await readFile(path, "utf8")) as Probe;
        if (cached.url === value && ["yes", "unknown"].includes(cached.result) && cached.checked_at) return cached;
      } catch {}
      if (!online) return null;
      let current = value;
      let count = 0;
      const result: Probe = { url: value, final_url: value, status: null, result: "unknown", checked_at: new Date().toISOString(), requests: 0 };
      try {
        for (let hop = 0; hop <= 5; hop++) {
          const url = await publicTarget(current);
          await delay(Math.max(0, 1000 - (Date.now() - lastStart)));
          lastStart = Date.now(); requests++; count++;
          const response = await fetch(url, { dispatcher: agent, redirect: "manual", signal: AbortSignal.timeout(8000),
            headers: { "User-Agent": "Vantage-discovery-readonly/1.0", Accept: "application/rss+xml, application/atom+xml, application/json, application/xml" } });
          result.final_url = url.toString(); result.status = response.status;
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get("location");
            if (!location || hop === 5) break;
            current = new URL(location, url).toString();
            continue;
          }
          if (!response.ok || !response.body) { await response.body?.cancel(); break; }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let text = "";
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 128_000) throw new Error("Discovery response too large");
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
            if (/<(?:rss|feed)(?:\s|>)/i.test(text) && !/<html(?:\s|>)/i.test(text)) result.result = "yes";
            if (url.pathname.endsWith("/latest.json")) {
              const json: unknown = JSON.parse(text);
              if (json && typeof json === "object" && "topic_list" in json && json.topic_list && typeof json.topic_list === "object" &&
                "topics" in json.topic_list && Array.isArray(json.topic_list.topics)) result.result = "yes";
            }
          } finally { await reader.cancel(); }
          break;
        }
      } catch {}
      result.requests = count;
      await mkdir(cacheDir, { recursive: true });
      await writeFile(path, JSON.stringify(result, null, 2) + "\n");
      return result;
    },
  };
}
