import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

let worker;
let origin;
let output = "";

before(async () => {
	const port = await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port: availablePort } = server.address();
			server.close((error) => error ? reject(error) : resolve(availablePort));
		});
	});
	origin = `http://127.0.0.1:${port}`;
	worker = spawn(process.execPath, [fileURLToPath(new URL("bin/wrangler.js", import.meta.resolve("wrangler/package.json"))), "dev", "--local", "--port", String(port), "--ip", "127.0.0.1", "--log-level", "error"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	worker.stdout.on("data", (chunk) => { output += chunk; });
	worker.stderr.on("data", (chunk) => { output += chunk; });

	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (worker.exitCode !== null) throw new Error(`Wrangler exited before becoming ready:\n${output}`);
		try {
			const response = await fetch(`${origin}/blog`, { signal: AbortSignal.timeout(5_000) });
			await response.body?.cancel();
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Wrangler did not become ready:\n${output}`);
}, { timeout: 90_000 });

after(async () => {
	if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
	const closed = once(worker, "close");
	worker.kill("SIGTERM");
	await closed;
}, { timeout: 15_000 });

test("blog posts and tag pages resolve through the built Cloudflare Worker", { timeout: 45_000 }, async () => {
	const post = await fetch(`${origin}/blog/find-customers-on-reddit-without-spamming`, { signal: AbortSignal.timeout(10_000) });
	assert.equal(post.status, 200, output);
	assert.match(await post.text(), /How to find customers on Reddit without spamming/);

	const tag = await fetch(`${origin}/blog/tag/community-marketing`, { signal: AbortSignal.timeout(10_000) });
	assert.equal(tag.status, 200, output);
	const tagHtml = await tag.text();
	assert.match(tagHtml, /Posts about community marketing/);
	assert.match(tagHtml, /find-customers-on-reddit-without-spamming/);

	const missingPost = await fetch(`${origin}/blog/not-a-published-post`, { signal: AbortSignal.timeout(10_000) });
	assert.equal(missingPost.status, 404);
	await missingPost.body?.cancel();
	const missingTag = await fetch(`${origin}/blog/tag/not-a-published-tag`, { signal: AbortSignal.timeout(10_000) });
	assert.equal(missingTag.status, 404);
	await missingTag.body?.cancel();
});
