import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { CurrentAuthorProfileCard } from "../../src/react/canvas-feedback.js"
import { critStyles } from "../../src/react/crit-styles.js"
import {
  currentAuthorNameLabel,
  currentAuthorProfile,
  readPersistedAuthorDisplayName,
  writePersistedAuthorDisplayName,
  type AuthorProfileStorage
} from "../../src/react/current-author-profile.js"

const memoryStorage = (): AuthorProfileStorage & {
  readonly values: Map<string, string>
} => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

describe("current author profile", () => {
  it("treats Git Handle as separate from Display Name and keeps email", () => {
    const author = {
      id: "git:willa",
      name: "wking-io",
      email: "contact@wking.dev",
      handle: "wking-io"
    }

    expect(currentAuthorProfile(author, null)).toEqual({
      displayName: "",
      email: "contact@wking.dev",
      handle: "wking-io"
    })
    expect(currentAuthorNameLabel("")).toBe("Missing name")
    expect(currentAuthorProfile(author, "Will King")).toEqual({
      displayName: "Will King",
      email: "contact@wking.dev",
      handle: "wking-io"
    })
  })

  it("uses the signed-in name until a stored Display Name exists", () => {
    expect(currentAuthorProfile({
      id: "signed-in:ada@example.com",
      name: "Ada Lovelace",
      email: "Ada@Example.com"
    }, null)).toEqual({
      displayName: "Ada Lovelace",
      email: "Ada@Example.com",
      handle: null
    })
  })

  it("round-trips a stored Display Name per Author", () => {
    const storage = memoryStorage()

    expect(writePersistedAuthorDisplayName(storage, "git:willa", "Will King"))
      .toBe(true)
    expect(readPersistedAuthorDisplayName(storage, "git:willa")).toBe("Will King")
    expect(readPersistedAuthorDisplayName(storage, "git:other")).toBeNull()
  })

  it("renders Missing name, email, handle, and the feather edit control", () => {
    const html = renderToStaticMarkup(
      <CurrentAuthorProfileCard
        displayName=""
        editing={false}
        email="contact@wking.dev"
        handle="wking-io"
        nameDraft=""
        onCancelEdit={() => {}}
        onEdit={() => {}}
        onNameDraftChange={() => {}}
        onSaveName={() => {}}
      />
    )

    expect(html).toContain("Missing name")
    expect(html).toContain("contact@wking.dev")
    expect(html).toContain("wking-io")
    expect(html).not.toContain("git:")
    expect(html).toContain('aria-label="Edit name"')
    expect(html).toContain("crit-presence__edit")
    expect(html).toContain('data-missing="true"')
    expect(critStyles).toContain(
      ".crit-presence__name { color: var(--crit-color-t2"
    )
    expect(critStyles).toContain(
      ".crit-presence__secondary, .crit-presence__handle { color: var(--crit-color-t1"
    )
    expect(critStyles).toContain("font: 400 14px/20px")
  })

  it("keeps email and Handle visible while the Display Name is an Enter-to-save field", () => {
    const html = renderToStaticMarkup(
      <CurrentAuthorProfileCard
        displayName="Will King"
        editing
        email="contact@wking.dev"
        handle="wking-io"
        nameDraft="Will King"
        onCancelEdit={() => {}}
        onEdit={() => {}}
        onNameDraftChange={() => {}}
        onSaveName={() => {}}
      />
    )

    expect(html).toContain('data-editing="true"')
    expect(html).toContain('value="Will King"')
    expect(html).toContain('aria-label="Display name"')
    expect(html).toContain('aria-label="Save name"')
    expect(html).toContain("contact@wking.dev")
    expect(html).toContain("wking-io")
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain("data-1p-ignore")
    expect(html).toContain('data-lpignore="true"')
    expect(html).not.toContain('autoComplete="name"')
  })
})
