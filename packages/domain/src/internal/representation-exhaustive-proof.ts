import type { RepresentationRef } from "../representation.js"

export const representationKind = (representation: RepresentationRef) => {
  switch (representation._tag) {
    case "applicationRoute":
      return representation._tag
    case "webUrl":
      return representation._tag
    case "artifact":
      return representation._tag
    default: {
      const exhaustive: never = representation
      return exhaustive
    }
  }
}
