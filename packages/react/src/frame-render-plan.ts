import {
  RepresentationRef,
  type ChangeId
} from "@crit/domain"
import type { RenderPlan } from "@crit/representations"
import { Schema } from "effect"
import { Atom } from "effect/unstable/reactivity"
import type { AsyncResult } from "effect/unstable/reactivity/AsyncResult"

import type {
  FrameRendererFrame,
  FrameRepresentationResolver
} from "./frame-renderer.js"

let nextResolverId = 0
const resolverIds = new WeakMap<FrameRepresentationResolver, number>()

const frameResolverId = (resolver: FrameRepresentationResolver) => {
  const existing = resolverIds.get(resolver)
  if (existing !== undefined) return existing
  nextResolverId += 1
  resolverIds.set(resolver, nextResolverId)
  return nextResolverId
}

const encodeRepresentation = Schema.encodeUnknownSync(RepresentationRef)

const planAtoms = new Map<string, Atom.Atom<AsyncResult<RenderPlan, unknown>>>()

const frameRenderPlanKey = (
  resolver: FrameRepresentationResolver,
  revision: ChangeId,
  representation: RepresentationRef
) =>
  `${frameResolverId(resolver)}:${revision}:${JSON.stringify(encodeRepresentation(representation))}`

export const frameRenderPlanFor = (
  resolver: FrameRepresentationResolver,
  frame: FrameRendererFrame
): Atom.Atom<AsyncResult<RenderPlan, unknown>> => {
  const cacheKey = frameRenderPlanKey(
    resolver,
    frame.representationChangedByChangeId,
    frame.representation
  )
  const existing = planAtoms.get(cacheKey)
  if (existing !== undefined) return existing
  const atom = Atom.make(resolver.resolve(frame.representation)).pipe(
    Atom.setIdleTTL(0)
  )
  planAtoms.set(cacheKey, atom)
  return atom
}
