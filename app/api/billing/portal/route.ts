import { openCustomerPortal } from "@/lib/billing/routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return openCustomerPortal(request);
}
