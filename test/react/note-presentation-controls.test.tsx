import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { NotePresentationControls } from "../../src/react/note-presentation-controls.js"
import { DEFAULT_NOTE_PRESENTATION_THRESHOLDS } from "../../src/react/note-presentation.js"

describe("NotePresentationControls", () => {
  it("shows the active collapse and reveal thresholds", () => {
    const html = renderToStaticMarkup(
      <NotePresentationControls
        onChange={() => undefined}
        onZoomChange={() => undefined}
        thresholds={DEFAULT_NOTE_PRESENTATION_THRESHOLDS}
        zoom={.65}
      />
    )

    expect(html).toContain('aria-label="Canvas debug controls"')
    expect(html).toContain('aria-label="Canvas zoom"')
    expect(html).toContain("65%")
    expect(html).toContain('aria-label="Collapse notes below"')
    expect(html).toContain('value="50"')
    expect(html).toContain("50%")
    expect(html).toContain('aria-label="Reveal notes above"')
    expect(html).toContain('value="52"')
    expect(html).toContain("52%")
    expect(html).toContain('max="200"')
  })
})
