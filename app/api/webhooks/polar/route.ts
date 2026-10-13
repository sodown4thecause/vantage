import { handlePolarWebhook } from "@/lib/billing/webhook";

/** Polar webhooks. No session: the Standard Webhooks signature is the authentication. */
export async function POST(request: Request) {
  return handlePolarWebhook(request);
}
