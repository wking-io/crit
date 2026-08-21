import type { RepresentationRef } from "../representation.js"

export const representationKind = (representation: RepresentationRef) => {
  switch (representation._tag) {
    case "application-route":
      return representation._tag
    case "web-url":
      return representation._tag
    case "artifact":
      return representation._tag
    default: {
      const exhaustive: never = representation
      return exhaustive
    }
  }
}
