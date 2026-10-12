# Blog posts

Each `.md` file here (except `README.md` and files starting with `_`) is a post at
`/blog/<file-name>`.

1. Copy `_template.md` to `<slug>.md` and fill in the frontmatter.
2. Run `pnpm blog:build`. It validates the frontmatter, renders the Markdown
   and writes `lib/blog/posts.generated.ts`.
3. Commit both files and open a PR. Deploying the merge publishes the post,
   adds it to the sitemap, RSS feed (`/blog/rss.xml`) and `/llms.txt`.

`pnpm build` also regenerates the module, and the test suite fails if the
committed module is out of date, so a forgotten step 2 is caught in CI.
