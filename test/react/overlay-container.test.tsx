import { readFileSync } from "node:fs"
import path from "node:path"

import { Effect } from "effect"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CanvasActionRunnerProvider } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"
import { cssVariableStyle } from "../../src/react/css-variable-style.js"
import {
  CritMenuSpecimen,
  extraCanvasContextMenuItems,
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

  it("projects extra canvas menus into a labeled playground submenu", () => {
    const items = extraCanvasContextMenuItems([{
      label: "Playground",
      description: "Choose which editor version the playground loads.",
      items: [
        {
          label: "Development",
          description: "Comments on",
          selected: true,
          onSelect: () => undefined
        },
        {
          label: "Alpha",
          description: "Comments hidden",
          onSelect: () => undefined
        },
        {
          label: "Release",
          description: "Packed editor",
          onSelect: () => undefined
        }
      ]
    }])
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <CritMenuSpecimen ariaLabel="Canvas menu specimen" items={items} />
      </CanvasActionRunnerProvider>
    )

    expect(items[0]).toMatchObject({
      label: "Playground",
      description: "Choose which editor version the playground loads."
    })
    expect("items" in items[0]! ? items[0].items.map((item) => ({
      label: item.label,
      selected: item.selected === true
    })) : []).toEqual([
      { label: "Development", selected: true },
      { label: "Alpha", selected: false },
      { label: "Release", selected: false }
    ])
    expect(html).toContain("min-height:36px")
    const menuSource = readFileSync(
      path.resolve("src/react/canvas-context-menu.tsx"),
      "utf8"
    )
    expect(menuSource).toContain('"data-selected": item.selected === true ? "" : undefined')
    expect(menuSource).toContain("crit-context-menu__check")
    expect(menuSource).toContain('<Glyph name="check2" />')
    expect(menuSource).not.toContain("crit-canvas-switcher__indicator")
  })
})
