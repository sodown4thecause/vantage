# scrollcraft engine (vendored)

`scrollcraft.js` is copied verbatim from
[nateherkai/scroll-craft](https://github.com/nateherkai/scroll-craft) v0.3.1
(commit `75d81f7`), MIT licensed (see `LICENSE`). Do not edit it per page: it is
the mechanism. Pages drive it with `data-sc-*` attributes and their own CSS.

The upstream `scrollcraft.css` is not imported. It styles `html`, `body` and
bare elements, which would leak into the rest of the app once loaded. The
device rules a page needs are restated, scoped, in that page's CSS module
(see `app/tour/tour.module.css`).
