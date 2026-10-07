// End-to-end build tests: write throwaway fixture posts, run a real `astro build`
// into a temp dir, and assert on the generated output. Run with `npm test`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const astroBin = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
const postsDir = join(root, 'src', 'content', 'posts');
const fixtureDir = join(postsDir, 'zz-fixture');
const outDir = join(root, '.test-dist');
const SITE = 'https://blog.test';

const DESC = 'A fixture description that is comfortably longer than the fifty character minimum.';
const post = (front, body = 'Body text.') => `---\n${front}\n---\n${body}\n`;

const build = (env) =>
  execFileSync(process.execPath, [astroBin, 'build', '--outDir', outDir], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
const read = (path) => readFileSync(join(outDir, path), 'utf8');

describe('blog build', () => {
  before(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      join(fixtureDir, 'nested-post.md'),
      post(`title: "Nested fixture post"\ndescription: "${DESC}"\npubDate: 2026-10-08`),
    );
    writeFileSync(
      join(fixtureDir, 'draft-post.md'),
      post(`title: "Draft fixture post"\ndescription: "${DESC}"\npubDate: 2026-10-09\ndraft: true`),
    );
    writeFileSync(
      join(fixtureDir, 'script-post.md'),
      post(
        `title: "Script fixture post"\ndescription: "${DESC}"\npubDate: 2026-10-10\n` +
          `faq:\n  - q: "Is it safe?"\n    a: "</script><script>alert(1)</script>"`,
      ),
    );
    rmSync(outDir, { recursive: true, force: true });
    build({ SITE_URL: SITE });
  });

  after(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('serves nested posts at the URL the index, RSS and llms.txt link to', () => {
    assert.ok(existsSync(join(outDir, 'posts', 'zz-fixture', 'nested-post', 'index.html')));
    for (const file of ['index.html', 'rss.xml', 'llms.txt']) {
      assert.match(read(file), /\/posts\/zz-fixture\/nested-post\//, file);
    }
  });

  it('excludes drafts everywhere', () => {
    assert.ok(!existsSync(join(outDir, 'posts', 'zz-fixture', 'draft-post')));
    for (const file of ['index.html', 'rss.xml', 'llms.txt', 'sitemap-0.xml']) {
      assert.doesNotMatch(read(file), /draft-post|Draft fixture/, file);
    }
  });

  it('orders posts newest first', () => {
    const llms = read('llms.txt');
    assert.ok(llms.indexOf('Script fixture post') < llms.indexOf('Nested fixture post'));
    assert.ok(llms.indexOf('Nested fixture post') < llms.indexOf('Hello, world'));
  });

  it('derives canonicals, sitemap and robots from SITE_URL', () => {
    assert.match(read('posts/hello-world/index.html'), new RegExp(`rel="canonical" href="${SITE}/posts/hello-world/"`));
    assert.match(read('sitemap-0.xml'), new RegExp(`${SITE}/posts/hello-world/`));
    assert.match(read('robots.txt'), new RegExp(`Sitemap: ${SITE}/sitemap-index.xml`));
    assert.doesNotMatch(read('index.html'), /example\.com/);
  });

  it('escapes < in JSON-LD so content cannot close the script tag', () => {
    const html = read('posts/zz-fixture/script-post/index.html');
    assert.doesNotMatch(html, /<script>alert\(1\)/);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    assert.equal(blocks.length, 2);
    const faq = JSON.parse(blocks[1][1]);
    assert.equal(faq.mainEntity[0].acceptedAnswer.text, '</script><script>alert(1)</script>');
  });

  it('fails the build when SITE_URL is unset', () => {
    assert.throws(() => build({ SITE_URL: '' }), (err) => /SITE_URL is required/.test(String(err.stderr)));
  });

  it('rejects blank titles and empty FAQs at build time', () => {
    writeFileSync(join(fixtureDir, 'bad-post.md'), post(`title: "   "\ndescription: "${DESC}"\npubDate: 2026-10-11\nfaq: []`));
    try {
      assert.throws(
        () => build({ SITE_URL: SITE }),
        (err) => /title/.test(String(err.stderr)) && /faq/.test(String(err.stderr)),
      );
    } finally {
      rmSync(join(fixtureDir, 'bad-post.md'));
    }
  });
});
