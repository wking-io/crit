import { describe, expect, it } from "vitest"

import {
  activeCanvasHelpDetails,
  type CanvasHelpDetails
} from "../../src/react/canvas-help.js"

const SELECT_HELP: CanvasHelpDetails = {
  name: "Select",
  hotkey: "V",
  description: "Select canvas items."
}

describe("Canvas help", () => {
  it("hides focused help while the pointer is over a target without help", () => {
    expect(activeCanvasHelpDetails(null, SELECT_HELP)).toBeNull()
  })

  it("keeps keyboard help active until pointer interaction enters the surface", () => {
    expect(activeCanvasHelpDetails(undefined, SELECT_HELP)).toEqual(SELECT_HELP)
  })
})
