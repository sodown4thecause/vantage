export type FakePut = {
  key: string;
  body: ArrayBuffer | string;
  contentType: string | undefined;
};

/** Stand-in for env.ARTIFACTS (an R2 bucket). In memory, no network. */
export function createFakeR2(opts: { throws?: Error } = {}) {
  const puts: FakePut[] = [];
  const bucket = {
    async put(key: string, body: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }) {
      if (opts.throws) throw opts.throws;
      puts.push({ key, body, contentType: options?.httpMetadata?.contentType });
      return { key };
    },
  };
  return { bucket, puts };
}
