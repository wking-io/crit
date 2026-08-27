import { Schema } from "effect"

import { Author } from "@riff-refine/crit"

export const LAUNCH_AUTHOR_STORAGE_KEY = "@riff-refine/crit/www-author"

const decodeAuthor = Schema.decodeUnknownSync(Author)

export const readLaunchAuthor = (): Author | null => {
  try {
    const source = globalThis.localStorage?.getItem(LAUNCH_AUTHOR_STORAGE_KEY)
    if (source === null || source === undefined) return null
    return decodeAuthor(JSON.parse(source))
  } catch {
    return null
  }
}

export const writeLaunchAuthor = (author: Author) => {
  try {
    globalThis.localStorage?.setItem(
      LAUNCH_AUTHOR_STORAGE_KEY,
      JSON.stringify(author)
    )
  } catch {
    return
  }
}
