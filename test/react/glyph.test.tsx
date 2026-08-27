import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  glyphDefinitions,
  glyphNames,
  glyphSvgMarkup
} from "../../src/glyphs/index.js"
import { Glyph, GlyphProvider } from "../../src/react/glyph.js"

describe("Glyph", () => {
  it("keeps every generated name, definition, and stable source serializer aligned", () => {
    expect(Object.keys(glyphDefinitions)).toEqual([...glyphNames])
    expect(glyphNames).toContain("commentPin")
    expect(glyphNames).toContain("copy")
    expect(glyphNames).toContain("check2")
    expect(glyphNames).toContain("loader")
    expect(glyphSvgMarkup("check2")).toContain("M2.75 9.5L6.5 13.25L15.25 4.5")
    expect(glyphSvgMarkup("loader")).toContain("M9 1.75V4.25")
    expect(glyphSvgMarkup("commentPin")).toContain('viewBox="0 0 16 16"')
    expect(glyphSvgMarkup("commentPin")).toContain('fill-rule="evenodd"')
  })

  it("renders a self-contained fallback when no sheet provider owns the document", () => {
    const html = renderToStaticMarkup(<Glyph name="close" />)

    expect(html).toContain("<path")
    expect(html).not.toContain("<use")
    expect(html).toContain('aria-hidden="true"')
  })

  it("owns one uniquely-prefixed sheet across nested providers", () => {
    const html = renderToStaticMarkup(
      <GlyphProvider>
        <Glyph name="comment" />
        <GlyphProvider><Glyph name="trash" /></GlyphProvider>
      </GlyphProvider>
    )
    const sheetCount = html.match(/data-crit-glyph-sheet/g)?.length ?? 0
    const symbolCount = html.match(/<symbol/g)?.length ?? 0
    const references = [...html.matchAll(/<use href="#([^"]+)"/g)].map((match) => match[1])

    expect(sheetCount).toBe(1)
    expect(symbolCount).toBe(glyphNames.length)
    expect(references).toHaveLength(2)
    expect(references.every((reference) => reference?.startsWith("crit-glyph-"))).toBe(true)
  })

  it("does not reuse fragment IDs across sibling document owners", () => {
    const html = renderToStaticMarkup(
      <>
        <GlyphProvider><Glyph name="comment" /></GlyphProvider>
        <GlyphProvider><Glyph name="comment" /></GlyphProvider>
      </>
    )
    const references = [...html.matchAll(/<use href="#([^"]+)"/g)].map((match) => match[1])

    expect(new Set(references).size).toBe(2)
  })

  it("allows an accessible name to override the decorative default", () => {
    const html = renderToStaticMarkup(<Glyph aria-label="Comment" name="comment" />)

    expect(html).toContain('aria-label="Comment"')
    expect(html).not.toContain("aria-hidden")
  })

  it("rejects unknown glyph names at compile time", () => {
    type GlyphNameProp = Parameters<typeof Glyph>[0]["name"]
    type UnknownGlyphRejected = "not-a-glyph" extends GlyphNameProp ? never : true
    const unknownGlyphRejected: UnknownGlyphRejected = true
    expect(unknownGlyphRejected).toBe(true)
  })
})
