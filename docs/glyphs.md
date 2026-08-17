# Glyphs

Crit keeps icon artwork as individual SVG files in `src/glyphs/icons`. Running
`npm run generate:glyphs` validates those files and produces the typed,
renderer-neutral map in `src/glyphs/definitions.ts`.

All new application glyphs come from the licensed **Nucleo UI Outline Duo 18**
family. Search and fetch them through the Nucleo skill and MCP, then use the
guarded importer with the file returned by `nucleo_get_icon`:

```sh
npm run import:glyph -- --source /absolute/nucleo/ui/icons/123.svg --name archive
npm run generate:glyphs
```

The importer verifies the source against Nucleo's UI catalog, accepts only
`outline-duo` at `18px`, records the Nucleo label and ID in the SVG, and removes
root width and height so the runtime controls rendered size. Reuse an existing
glyph when it already has the requested meaning.

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

Use the established context size rather than changing source geometry: toolbar
and menu glyphs render at 16px, comment pins and note controls at 18px, and
frame chrome scales with `--crit-ui`. Keep interaction state, focus, keyboard,
tooltip, and loading behavior on the owning control rather than the SVG.

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
