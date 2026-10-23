# Vantage design system (workspace)

Vantage is a lookout post: a short list of conversations worth joining, each with the evidence behind it.

- **Tokens** live in `app/globals.css`: paper, sheet, ink, ridge, contour, signal (the only accent), flag (low confidence), stop (errors). Dark mode swaps the same names.
- **Type**: Schibsted Grotesk for the interface, Newsreader for other people's words (evidence quotes, class `.quote`), so quoted text is visibly not Vantage's own.
- **Evidence**: source messages stay next to the conversation, with restrained entrance transitions and a reduced-motion alternative. `components/glyph.tsx` remains the five-score evidence mark where scores are useful, not the landing-page hero.
- **Workspace shell**: `components/workspace-frame.tsx` owns the shared sidebar, topbar, account navigation and responsive content area. `Shell` delegates every workspace-scoped page to this frame; the live assistant and `/tour` use it directly with a focused conversation layout. Never build a second app sidebar for a page.
- **Public shell**: `components/shell.tsx` uses the same dark surfaces, hairline borders, sans headings, compact cobalt buttons and spacing for the landing page, authentication, pricing, blog and launch catalog. Marketing pages keep a public header and footer rather than pretending to be signed-in workspaces.
- **Tour**: a click-driven sample workspace with deterministic responses, three next actions and inspectable evidence. No pinned scrolling engine. Label sample data and future workflow previews explicitly.
- **Buttons and headings**: restrained sans typography, eight-pixel button corners and a single cobalt action color. Avoid oversized decorative glyphs, pill-button systems and tracked uppercase labels.
- **Legacy pages**: older pages still use Tailwind `zinc-*` classes. The zinc ramp is remapped to paper/ink in `globals.css`, so they follow the palette; restyle them to tokens when touched.
- **auth-ui** sets `* { border-color }` outside Tailwind layers, so utilities that must win (`border-signal`, `border-contour`) are restated unlayered in `globals.css`.
- **Rules**: sentence case, no tracked-caps labels, no dot-joined meta strings, one accent, no card grids.
