export function requiredEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
  hint?: string,
): string {
  const value = env[name];
  if (!value?.trim()) {
    const suffix = hint ? `. ${hint}` : "";
    throw new Error(
      `Required environment variable ${name} is not configured${suffix}`,
    );
  }
  return value;
}
