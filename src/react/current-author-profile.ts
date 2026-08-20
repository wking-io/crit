import { Schema } from "effect"

import type { Author } from "../core/index.js"

export const MISSING_AUTHOR_NAME = "Missing name"

const SIGNED_IN_PREFIX = "signed-in:"

export interface AuthorProfileStorage {
  readonly getItem: (key: string) => string | null
  readonly removeItem: (key: string) => void
  readonly setItem: (key: string, value: string) => void
}

export interface CurrentAuthorProfile {
  readonly displayName: string
  readonly email: string | null
  readonly handle: string | null
}

const displayNameStorageKey = (authorId: string) =>
  `@riff-refine/crit/author-name/${encodeURIComponent(authorId)}`

const PersistedAuthorDisplayName = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: Schema.String
})
const decodePersistedAuthorDisplayName = Schema.decodeUnknownSync(
  PersistedAuthorDisplayName
)

const signedInEmail = (authorId: string) =>
  authorId.startsWith(SIGNED_IN_PREFIX)
    ? authorId.slice(SIGNED_IN_PREFIX.length)
    : null

export const currentAuthorProfile = (
  author: Author,
  storedDisplayName: string | null
): CurrentAuthorProfile => {
  const stored = storedDisplayName?.trim() ?? ""
  const email = author.email?.trim() || signedInEmail(author.id)
  const handle = author.handle?.trim() || null
  const displayName = storedDisplayName !== null
    ? stored
    : handle === null
      ? author.name.trim()
      : ""
  return {
    displayName,
    email: email && email.length > 0 ? email : null,
    handle
  }
}

export const currentAuthorNameLabel = (displayName: string) =>
  displayName.length === 0 ? MISSING_AUTHOR_NAME : displayName

export const browserAuthorProfileStorage = (): AuthorProfileStorage | null => {
  try {
    return globalThis.document?.defaultView?.localStorage ?? null
  } catch {
    return null
  }
}

export const readPersistedAuthorDisplayName = (
  storage: AuthorProfileStorage,
  authorId: string
): string | null => {
  try {
    const source = storage.getItem(displayNameStorageKey(authorId))
    if (source === null) return null
    return decodePersistedAuthorDisplayName(JSON.parse(source)).name
  } catch {
    return null
  }
}

export const writePersistedAuthorDisplayName = (
  storage: AuthorProfileStorage,
  authorId: string,
  name: string
) => {
  try {
    storage.setItem(displayNameStorageKey(authorId), JSON.stringify({
      schemaVersion: 1,
      name
    }))
    return true
  } catch {
    return false
  }
}
