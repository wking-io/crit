# Glyphs

Crit keeps icon artwork as individual SVG files in `src/glyphs/icons`. Running
`npm run generate:glyphs` validates those files and produces the typed,
renderer-neutral map in `src/glyphs/definitions.ts`.

React callers render a named glyph:

```tsx
import { Glyph } from "@riff-refine/crit"

<button aria-label="Delete note">
  <Glyph name="trash" />
</button>
```

`Crit` owns a `GlyphProvider` automatically. Other application roots that use
exported glyphs should mount one provider around the root. A provider emits one
inline symbol sheet with a unique prefix; nested providers reuse their owner's
sheet. This makes multiple Crit roots safe in the same document. A glyph used
without a provider renders its paths inline, which keeps isolated SSR and tests
self-contained.

Glyphs are decorative by default. Supplying `aria-label` or `aria-labelledby`
makes the SVG accessible instead. Prefer labeling the containing button when
the glyph represents an action.

The generator rejects unsupported elements, unsupported attributes, missing
`viewBox` values, invalid filenames, and filename collisions. It flattens
groups while preserving explicitly supported inherited presentation
attributes. `npm run check:glyphs` fails when the generated map is stale and is
part of typechecking.

The Frame comment bridge uses the same generated definition through
`glyphSvgMarkup`; it cannot share the parent document's symbols because it runs
inside the framed document. CSS cursor data URLs remain standalone cursor
assets for the same document-isolation reason and are not part of the DOM glyph
sheet.
