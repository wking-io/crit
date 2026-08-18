import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  isSignInComplete,
  SignInForm,
  signedInAuthor
} from "../../src/react/sign-in-dialog.js"

describe("Sign-in", () => {
  it("builds a Current Author from the signed-in name and email", () => {
    expect(isSignInComplete("", "ada@example.com")).toBe(false)
    expect(isSignInComplete("Ada", "ada")).toBe(false)
    expect(isSignInComplete("Ada Lovelace", "ada@example.com")).toBe(true)
    expect(signedInAuthor("Ada Lovelace", "Ada@Example.com")).toEqual({
      id: "signed-in:ada@example.com",
      name: "Ada Lovelace"
    })
  })

  it("renders the library dialog chrome for signing in", () => {
    const html = renderToStaticMarkup(
      <SignInForm
        onCancel={() => {}}
        onSignIn={() => {}}
      />
    )

    expect(html).toContain("Sign in to add frames and notes")
    expect(html).toContain("crit-new-frame-dialog")
    expect(html).toContain('type="email"')
    expect(html).toContain("Sign in")
  })
})
