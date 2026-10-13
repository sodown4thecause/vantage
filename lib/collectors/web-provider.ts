/** `source.config.provider` for keyword search across public developer forums and blogs (a `web_search` source). */
export const WEB_DISCUSSIONS_PROVIDER = "tinyfish-web";

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-cased hostname without `www.`; undefined for anything that is not a plain public host. */
export function bareHost(value: string): string | undefined {
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    return HOST_RE.test(host) ? host : undefined;
  } catch { return undefined; }
}
