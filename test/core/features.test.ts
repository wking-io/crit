import { describe, expect, it } from "vitest"

import {
  ALPHA_FEATURES,
  CanvasCommand,
  COMMENTS_UNAVAILABLE_DETAIL,
  DEFAULT_CRIT_FEATURES,
  DEVELOPMENT_FEATURES,
  critFeaturesForProfile,
  isCommentCommand,
  resolveCritFeatureProfile,
  resolveCritFeatures,
  unavailableCommentCommandDetail
} from "../../src/core/index.js"

const addFrame = CanvasCommand.addFrame({
  id: "candidate",
  url: "https://app.localhost/candidate",
  title: "Candidate",
  provenance: { kind: "manual", sourceId: "test" }
})

const addCommentThread = CanvasCommand.addCommentThread({
  id: "thread-1",
  frameId: "candidate",
  anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
  opening: {
    id: "comment-1",
    body: "Tighten this spacing",
    author: { id: "git-alice", name: "Alice" },
    createdAt: "2026-08-09T12:00:00.000Z",
    editedAt: null
  }
})

describe("Crit feature policy", () => {
  it("disables comments in the alpha profile and enables them in development", () => {
    expect(DEFAULT_CRIT_FEATURES).toEqual(ALPHA_FEATURES)
    expect(ALPHA_FEATURES).toEqual({ comments: false })
    expect(DEVELOPMENT_FEATURES).toEqual({ comments: true })
    expect(critFeaturesForProfile("alpha")).toEqual(ALPHA_FEATURES)
    expect(critFeaturesForProfile("development")).toEqual(DEVELOPMENT_FEATURES)
    expect(resolveCritFeatureProfile(undefined)).toBe("alpha")
    expect(resolveCritFeatureProfile("alpha")).toBe("alpha")
    expect(resolveCritFeatureProfile("development")).toBe("development")
    expect(resolveCritFeatures()).toEqual(ALPHA_FEATURES)
    expect(resolveCritFeatures({ comments: true })).toEqual(DEVELOPMENT_FEATURES)
  })

  it("identifies Comment commands through one schema", () => {
    expect(isCommentCommand(addCommentThread)).toBe(true)
    expect(isCommentCommand(CanvasCommand.replyToCommentThread({
      id: "thread-1",
      reply: {
        id: "reply-1",
        body: "On it",
        author: { id: "git-bob", name: "Bob" },
        createdAt: "2026-08-09T12:01:00.000Z",
        editedAt: null
      }
    }))).toBe(true)
    expect(isCommentCommand(addFrame)).toBe(false)
  })

  it("treats Comment commands as unavailable in the alpha profile", () => {
    expect(unavailableCommentCommandDetail([addCommentThread], ALPHA_FEATURES))
      .toBe(COMMENTS_UNAVAILABLE_DETAIL)
    expect(unavailableCommentCommandDetail([addFrame, addCommentThread], ALPHA_FEATURES))
      .toBe(COMMENTS_UNAVAILABLE_DETAIL)
    expect(unavailableCommentCommandDetail([addFrame], ALPHA_FEATURES))
      .toBeUndefined()
    expect(unavailableCommentCommandDetail([addCommentThread], DEVELOPMENT_FEATURES))
      .toBeUndefined()
  })
})
