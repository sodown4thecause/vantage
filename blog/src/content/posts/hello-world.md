---
title: "Hello, world: how this blog is built"
description: "A short tour of the Astro and Cloudflare Workers stack behind the Vantage blog, and why it is fast and search-friendly."
pubDate: 2026-10-07
tags: ["engineering"]
faq:
  - q: "What is this blog built with?"
    a: "Astro generates static HTML from Markdown files, and Cloudflare Workers serves it from the edge."
---
This blog is plain Markdown in git, built by Astro into static HTML and served by Cloudflare Workers.

Because every page is pre-rendered, search engines and AI crawlers see the full content without running JavaScript.
