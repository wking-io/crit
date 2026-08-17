---
name: crit-icons
description: Adds or replaces Crit application icons through the existing glyph pipeline using licensed Nucleo UI Outline Duo 18 artwork. Use when the user asks to add, insert, choose, change, or replace an icon or glyph in the app, including requests such as "add X icon to app."
---

# Crit Icons

Add icons through Crit's typed glyph system. Treat Nucleo UI Outline Duo 18 as
the source library and the repository as the runtime source of truth.

## Workflow

1. Call `nucleo_list_families` before the first Nucleo search in the
   conversation and confirm the vanilla target and installed `ui` family.
2. Inspect `src/glyphs/definitions.ts` and current call sites for a glyph that
   already expresses the requested action. Reuse it when its meaning is clear.
3. For a new need, call `nucleo_search_icons` with `family: "ui"`,
   `fill: "outline-duo"`, `size: "18px"`, and `source: "literal"`. Search the
   requested term plus at most two useful semantic expansions, then choose for
   the control's actual action rather than visual novelty.
4. Call `nucleo_get_icon` for the chosen result with `family: "ui"` and
   `format: "file"`. Import that path with
   `npm run import:glyph -- --source <path> --name <semantic-kebab-name>`.
   The guarded importer verifies family, style, size, and catalog provenance.
5. Run `npm run generate:glyphs`. Import `Glyph` and render the generated
   camel-case name rather than embedding SVG or importing a separate icon
   package.
6. Put behavior on the owning control. Keep decorative glyphs hidden through
   `Glyph`'s default behavior; label an icon-only button with the action's
   `aria-label`. Preserve the control's disabled, pressed, expanded, tooltip,
   focus, keyboard, and loading behavior.
7. Use the existing context size. Toolbar and menu glyphs render at 16px;
   comment pins and note controls render at 18px; frame chrome scales through
   `--crit-ui`. Add a context CSS rule only when the new location has no
   established size. Keep the SVG itself at `1em` through `Glyph`.
8. Run `npm run typecheck` and the focused tests for the changed control. Finish
   only when generated definitions are current and the interaction remains
   accessible by keyboard and screen reader.

## Boundaries

- Use `Glyph` for DOM application icons and `glyphSvgMarkup` only for isolated
  documents such as the Frame bridge.
- Keep cursor artwork and content illustrations outside the glyph sheet; they
  have different rendering constraints.
- Prefer the existing icon when the request changes placement or behavior but
  not meaning. Every genuinely new application glyph comes from Nucleo UI
  Outline Duo 18.
