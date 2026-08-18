import {
  ALPHA_FEATURES,
  DEVELOPMENT_FEATURES,
  type CritFeatures
} from "../../src/core/features.js"

export const PLAYGROUND_PROFILE_COOKIE = "crit-playground-profile"
export const PLAYGROUND_PROFILE_STORAGE_KEY = PLAYGROUND_PROFILE_COOKIE
export const PLAYGROUND_PROFILES = ["development", "alpha", "release"] as const
export type PlaygroundProfile = (typeof PLAYGROUND_PROFILES)[number]

export const isPlaygroundProfile = (
  value: string | null | undefined
): value is PlaygroundProfile =>
  value === "development" || value === "alpha" || value === "release"

export const playgroundProfile = (
  value: string | null | undefined,
  fallback: PlaygroundProfile = "development"
): PlaygroundProfile => isPlaygroundProfile(value) ? value : fallback

export const playgroundProfileFromCookie = (
  cookieHeader: string | null | undefined
): PlaygroundProfile | undefined => {
  if (cookieHeader === undefined || cookieHeader === null) return undefined
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name !== PLAYGROUND_PROFILE_COOKIE) continue
    const value = part.slice(separator + 1).trim()
    return isPlaygroundProfile(value) ? value : undefined
  }
  return undefined
}

export const resolvePlaygroundProfile = (input: {
  readonly url?: string | null
  readonly cookie?: string | null
  readonly stored?: string | null
  readonly fallback?: PlaygroundProfile
}): PlaygroundProfile => {
  if (isPlaygroundProfile(input.url)) return input.url
  const fromCookie = playgroundProfileFromCookie(input.cookie)
  if (fromCookie !== undefined) return fromCookie
  if (isPlaygroundProfile(input.stored)) return input.stored
  return input.fallback ?? "development"
}

export const featuresForPlaygroundProfile = (
  profile: PlaygroundProfile
): CritFeatures =>
  profile === "development" ? DEVELOPMENT_FEATURES : ALPHA_FEATURES

export const playgroundProfileCookie = (profile: PlaygroundProfile) =>
  `${PLAYGROUND_PROFILE_COOKIE}=${profile}; Path=/; SameSite=Lax`
