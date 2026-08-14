import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  CANVAS_ACTION_POLICIES,
  CanvasActionUnavailable,
  CanvasControls,
  makeCanvasControls,
  tanStackHotkeysForAction,
  type CanvasControlPlatform,
  type CanvasControlScope
} from "../../src/react/canvas-controls.js"

const resolve = (
  options: {
    readonly platform?: CanvasControlPlatform
    readonly activeScopes?: ReadonlyArray<CanvasControlScope>
    readonly commentAuthorPresent?: boolean
    readonly pendingActions?: ReadonlyArray<string>
  } = {}
) => CanvasControls.resolve({
  platform: options.platform ?? "macos",
  activeScopes: options.activeScopes ?? ["canvas"],
  globalFacts: {
    commentAuthorPresent: options.commentAuthorPresent ?? true
  },
  pendingActions: options.pendingActions ?? []
})

describe("CanvasControls", () => {
  it("resolves one action into consistent help, ARIA, and hotkey projections", () => {
    const action = resolve({ platform: "unknown" }).action({
      id: "remove-item",
      target: { kind: "frame", id: "candidate", label: "Candidate" }
    })

    expect(action).toMatchObject({
      key: "remove-item:frame:candidate",
      label: "Remove Candidate",
      description: "Remove this frame from the canvas.",
      consequence: "destructive",
      availability: "enabled",
      shortcut: "⌫",
      ariaKeyShortcuts: "Backspace Delete"
    })
    expect(tanStackHotkeysForAction(action)).toEqual([
      { key: "Backspace", mod: false, shift: false, alt: false },
      { key: "Delete", mod: false, shift: false, alt: false }
    ])
  })

  it("projects semantic modifiers for each platform and defaults unknown to macOS", () => {
    const actionFor = (platform: CanvasControlPlatform) =>
      resolve({ platform }).action({ id: "zoom-in" })

    expect(actionFor("macos").shortcut).toBe("⌘=")
    expect(actionFor("unknown").shortcut).toBe("⌘=")
    expect(actionFor("windows").shortcut).toBe("Ctrl+=")
    expect(actionFor("linux").ariaKeyShortcuts).toBe("Control+= Control+Shift+=")
    expect(tanStackHotkeysForAction(actionFor("linux"))).toEqual([
      { key: "=", mod: true, shift: false, alt: false },
      { key: "=", mod: true, shift: true, alt: false }
    ])
  })

  it("projects bindings only while one of the action's scopes is active", () => {
    expect(resolve().action({ id: "create-frame" }).shortcut).toBeNull()
    expect(resolve({
      activeScopes: ["canvas", "new-frame-form"]
    }).action({ id: "create-frame" }).shortcut).toBe("Enter")
  })

  it("keeps stable reason codes separate from user-facing availability copy", () => {
    const missingAuthor = resolve({ commentAuthorPresent: false }).action({
      id: "create-note"
    })
    expect(missingAuthor).toMatchObject({
      availability: "disabled",
      reason: "missing-comment-author",
      availabilityMessage: "Configure Git user.name and user.email to add notes."
    })

    const forbiddenRemoval = resolve().action({
      id: "remove-item",
      target: { kind: "note", id: "note-1", label: "note" },
      currentAuthorIsTargetAuthor: false
    })
    expect(forbiddenRemoval).toMatchObject({
      availability: "hidden",
      reason: "item-removal-forbidden"
    })
  })

  it("resolves concrete selection facts and arrangement variants", () => {
    const controls = resolve({ activeScopes: ["canvas", "arrangement-menu"] })
    expect(controls.action({
      id: "open-arrangement-menu",
      selectionHasMultipleItems: false
    })).toMatchObject({
      availability: "disabled",
      reason: "multiple-selection-required"
    })
    expect(controls.action({
      id: "align-selection",
      alignment: "horizontal-center",
      selectionHasMultipleItems: true
    })).toMatchObject({
      key: "align-selection:horizontal-center",
      label: "Align horizontal center",
      availability: "enabled"
    })
    expect(controls.action({
      id: "distribute-selection",
      axis: "vertical",
      selectionHasThreeItems: false
    })).toMatchObject({
      key: "distribute-selection:vertical",
      label: "Distribute vertically",
      reason: "three-item-selection-required"
    })
  })

  it("derives pending state from trusted execution input per identity and target", () => {
    const request = {
      id: "remove-item" as const,
      target: { kind: "frame" as const, id: "candidate", label: "Candidate" }
    }
    const action = resolve({
      pendingActions: ["remove-item:frame:candidate"]
    }).action(request)

    expect(action).toMatchObject({
      availability: "disabled",
      reason: "action-pending",
      availabilityMessage: "Wait for this action to finish."
    })
  })

  it("rejects unavailable invocation with a concrete typed Effect failure", async () => {
    const controls = resolve({ commentAuthorPresent: false })
    const action = controls.action({ id: "create-note" })
    const failure = await Effect.runPromise(
      Effect.flip(controls.invoke(action, Effect.succeed("created")))
    )

    expect(failure).toBeInstanceOf(CanvasActionUnavailable)
    expect(failure).toMatchObject({
      actionKey: "create-note",
      actionId: "create-note",
      availability: "disabled",
      reason: "missing-comment-author"
    })
  })

  it("fails construction when registered bindings collide in an active scope set", () => {
    const conflicting = CANVAS_ACTION_POLICIES.map((declaration) =>
      declaration.id === "hand-tool"
        ? {
            ...declaration,
            bindings: [{
              key: "V",
              modifiers: [],
              delivery: "registered" as const,
              role: "primary" as const
            }]
          }
        : declaration
    )

    expect(() => makeCanvasControls(conflicting)).toThrow(
      /select-tool and hand-tool use :v/
    )
  })

  it("allows the same registered binding in scopes that never activate together", () => {
    const separateScopes = CANVAS_ACTION_POLICIES.map((declaration) => {
      if (declaration.id === "create-frame") {
        return {
          ...declaration,
          bindings: [{
            key: "Enter",
            modifiers: [],
            delivery: "registered" as const,
            role: "primary" as const
          }]
        }
      }
      if (declaration.id === "save-frame-title-edit") {
        return {
          ...declaration,
          bindings: [{
            key: "Enter",
            modifiers: [],
            delivery: "registered" as const,
            role: "primary" as const
          }]
        }
      }
      return declaration
    })

    expect(() => makeCanvasControls(separateScopes)).not.toThrow()
  })
})
