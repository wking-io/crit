import { Match } from "effect"

import type { RepresentationRef } from "../representation.js"

export const representationKind = (representation: RepresentationRef) =>
  Match.value(representation).pipe(Match.tagsExhaustive({
    applicationRoute: () => "applicationRoute",
    webUrl: () => "webUrl",
    artifact: () => "artifact"
  }))
