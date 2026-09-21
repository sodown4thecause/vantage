export function requiredEnv(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  if (!value?.trim()) {
    throw new Error(`Required environment variable ${name} is not configured`);
  }
  return value;
}
