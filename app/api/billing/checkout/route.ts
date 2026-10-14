import { createCheckout } from "@/lib/billing/routes";

export async function POST(request: Request) {
  return createCheckout(request);
}
