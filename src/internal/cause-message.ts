import { Predicate } from "effect"

export const causeMessage = (cause: unknown, fallback?: string) =>
  Predicate.isError(cause) ? cause.message : fallback ?? String(cause)
