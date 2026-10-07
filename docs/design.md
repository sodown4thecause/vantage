# Vantage design system ("survey sheet")

Vantage is a lookout post: a short list of conversations worth joining, each with the evidence behind it.

- **Tokens** live in `app/globals.css`: paper, sheet, ink, ridge, contour, signal (the only accent), flag (low confidence), stop (errors). Dark mode swaps the same names.
- **Type**: Schibsted Grotesk for the interface, Newsreader for other people's words (evidence quotes, class `.quote`), so quoted text is visibly not Vantage's own.
- **Signature element**: `components/glyph.tsx` draws the five scores (fit, intent, evidence, momentum, timing) as a pentagon. It draws itself in once on the landing page; reduced motion turns that off.
- **Shell**: `components/shell.tsx` provides `Shell` (header, nav, width) and `PageHead`. Pages should use these rather than their own wrappers.
- **Legacy pages**: older pages still use Tailwind `zinc-*` classes. The zinc ramp is remapped to paper/ink in `globals.css`, so they follow the palette; restyle them to tokens when touched.
- **auth-ui** sets `* { border-color }` outside Tailwind layers, so utilities that must win (`border-signal`, `border-contour`) are restated unlayered in `globals.css`.
- **Rules**: sentence case, no tracked-caps labels, no dot-joined meta strings, one accent, no card grids.
