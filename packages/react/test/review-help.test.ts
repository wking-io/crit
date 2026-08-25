import { describe, expect, it } from "vitest"

import {
  activeReviewHelpDetails,
  type ReviewHelpDetails
} from "../src/review-help.js"

const SELECT_HELP: ReviewHelpDetails = {
  _tag: "informational",
  name: "Select",
  description: "Select canvas items."
}

describe("Review help", () => {
  it("hides focused help while the pointer is over a target without help", () => {
    expect(activeReviewHelpDetails(
      { _tag: "over", details: null },
      SELECT_HELP
    )).toBeNull()
  })

  it("keeps keyboard help active until pointer interaction enters the surface", () => {
    expect(activeReviewHelpDetails({ _tag: "away" }, SELECT_HELP)).toEqual(
      SELECT_HELP
    )
  })
})
