import { Context } from "effect"

import type { CritFeatures } from "../core/features.js"

export class CritFeaturePolicy extends Context.Service<
  CritFeaturePolicy,
  CritFeatures
>()("@riff-refine/crit/CritFeaturePolicy") {}
