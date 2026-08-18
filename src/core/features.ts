import { Schema } from "effect"

export const CritFeatures = Schema.Struct({
  comments: Schema.Boolean
})
export type CritFeatures = typeof CritFeatures.Type

export const ALPHA_FEATURES: CritFeatures = {
  comments: false
}

export const DEVELOPMENT_FEATURES: CritFeatures = {
  comments: true
}

export const DEFAULT_CRIT_FEATURES: CritFeatures = ALPHA_FEATURES

export const CritFeatureProfile = Schema.Literals(["alpha", "development"])
export type CritFeatureProfile = typeof CritFeatureProfile.Type

export const critFeaturesForProfile = (
  profile: CritFeatureProfile
): CritFeatures =>
  profile === "development" ? DEVELOPMENT_FEATURES : ALPHA_FEATURES

export const resolveCritFeatureProfile = (
  value: string | undefined
): CritFeatureProfile =>
  value === "development" ? "development" : "alpha"

export const resolveCritFeatures = (
  input: Partial<CritFeatures> | undefined = undefined
): CritFeatures => ({
  comments: input?.comments ?? DEFAULT_CRIT_FEATURES.comments
})

export const COMMENTS_UNAVAILABLE_DETAIL =
  "Comment commands are unavailable in this Crit profile"
