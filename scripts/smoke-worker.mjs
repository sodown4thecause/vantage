import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";

const port = 8799;
const config = "wrangler.smoke.jsonc";
const paths = ["/", "/pricing", "/robots.txt", "/auth/sign-in"];

// Remote-only bindings need a Cloudflare token, so the smoke config leaves them out.
writeFileSync(
	config,
	JSON.stringify({
		name: "vantage-smoke",
		main: "worker-entry.mjs",
		workers_dev: false,
		compatibility_date: "2026-10-05",
		compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
		assets: { directory: ".open-next/assets", binding: "ASSETS" },
		vars: {
			VANTAGE_SEMANTIC_MODE: "off",
			NEON_AUTH_BASE_URL: "https://auth.invalid",
			NEON_AUTH_COOKIE_SECRET: "smoke-test-cookie-secret-0123456789abcdef",
		},
	}),
);

const child = spawn("pnpm", ["exec", "wrangler", "dev", "--config", config, "--port", String(port)], {
	stdio: ["ignore", "inherit", "inherit"],
});

const cleanup = () => {
	child.kill("SIGTERM");
	rmSync(config, { force: true });
};

let failed = false;
try {
	const base = "http://127.0.0.1:" + port;
	let ready = false;
	for (let i = 0; i < 90 && !ready; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		ready = await fetch(base + "/robots.txt", { signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
	}
	if (!ready) throw new Error("Worker did not start within 90s");
	for (const path of paths) {
		const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30000) });
		const ok = res.status < 400;
		console.log((ok ? "ok   " : "FAIL ") + res.status + " " + path);
		if (!ok) failed = true;
	}
} catch (error) {
	console.error(error);
	failed = true;
} finally {
	cleanup();
}
process.exit(failed ? 1 : 0);
