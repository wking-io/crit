import { Effect } from "effect"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CanvasActionRunnerProvider } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"
import { cssVariableStyle } from "../../src/react/css-variable-style.js"
import {
  CritMenuSpecimen,
  type ContextMenuItem
} from "../../src/react/canvas-context-menu.js"
import { CritOverlayProvider } from "../../src/react/overlay-container.js"

describe("Crit overlay container", () => {
  it("renders a scoped portal target beside the themed surface", () => {
    const html = renderToStaticMarkup(
      <section
        className="host-theme"
        style={cssVariableStyle({ "--host-accent": "plum" })}
      >
        <CritOverlayProvider className="host-theme__overlays">
          <main>Canvas</main>
        </CritOverlayProvider>
      </section>
    )

    expect(html).toContain('class="host-theme"')
    expect(html).toContain("--host-accent:plum")
    expect(html).toContain("<main>Canvas</main>")
    expect(html).toContain(
      'class="crit-overlay-container host-theme__overlays"'
    )
    expect(html).toContain('data-crit-overlay-container=""')
  })

  it("reserves the Base UI lab menu's themed portal anchor", () => {
    const controls = CanvasControls.resolve({
      platform: "macos",
      activeScopes: ["canvas", "menu"],
      globalFacts: { commentAuthorPresent: true },
      pendingActions: []
    })
    const items: ReadonlyArray<ContextMenuItem> = [{
      action: controls.action({ id: "zoom-to-fit" }),
      execute: Effect.void
    }]
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <CritMenuSpecimen ariaLabel="Canvas menu specimen" items={items} />
      </CanvasActionRunnerProvider>
    )

    expect(html).toContain('data-crit-menu-specimen=""')
    expect(html).toContain('class="crit-context-menu-specimen__anchor"')
    expect(html).toContain("min-height:36px")
    expect(html).not.toContain("data-programmatic")
  })
})
