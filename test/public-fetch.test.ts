import { expect, it, vi } from "vitest";
import { fetchPublicText, isPublicHttpUrl } from "@/lib/http/public-fetch";

it("rejects local, credentialed and non-HTTP destinations before requesting them", async () => {
  const request = vi.fn();
  for (const url of ["http://localhost", "http://127.0.0.1", "http://[::1]", "http://169.254.169.254", "https://service.internal", "https://user:password@example.com", "file:///etc/passwd"]) {
    expect(isPublicHttpUrl(url)).toBe(false);
    await expect(fetchPublicText(url, {}, 64, request)).rejects.toThrow();
  }
  expect(request).not.toHaveBeenCalled();
  expect(isPublicHttpUrl("https://example.com/feed")).toBe(true);
});

it("disables redirect following and stops reading oversized responses", async () => {
  const cancel = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel,
  })));
  await expect(fetchPublicText("https://example.com/feed", {}, 64, request)).rejects.toThrow(/size/);
  expect(request.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  expect(cancel).toHaveBeenCalled();
});
