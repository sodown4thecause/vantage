import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/auth-ui", () => ({ NeonAuthUIProvider: () => null }));
vi.mock("@/lib/auth/client", () => ({ authClient: {} }));

import { Providers } from "@/app/providers";

afterEach(() => vi.unstubAllGlobals());

describe("auth navigation", () => {
  it("uses a fresh document after authentication instead of a prefetched anonymous page", () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { assign, replace } });
    const provider = Providers({ children: null });
    expect(provider.props.redirectTo).toBe("/setup");
    provider.props.navigate("/setup");
    expect(assign).toHaveBeenCalledWith("/setup");
    provider.props.replace("/auth/sign-in");
    expect(replace).toHaveBeenCalledWith("/auth/sign-in");
  });
});
