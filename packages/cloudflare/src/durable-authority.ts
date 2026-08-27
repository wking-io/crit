import {
  AuthorityView,
  CanvasAlreadyExists,
  CanvasAuthority,
  CanvasNotFound,
  ChangeIdReused,
  ChangeRejected,
  CursorNotFound
} from "@crit/authority"
import { DomainValue } from "@crit/domain"
import {
  ChangePageSchema,
  SubmitChangeReceiptSchema
} from "@crit/protocol"
import { Effect, Layer, Match, Schema } from "effect"

import {
  CanvasDurableObject,
  type DurableObjectResult
} from "./canvas-object.js"
import { DurableSqlRowLimitExceeded } from "./stored-json.js"

export interface DurableObjectAuthorityOptions {
  readonly testClockId?: string
}

const SubmitFailure = Schema.Union([
  CanvasNotFound,
  CursorNotFound,
  ChangeIdReused,
  ChangeRejected
])
const ChangesAfterFailure = Schema.Union([
  CanvasNotFound,
  CursorNotFound
])

const foldResult = <
  A,
  E,
  Value extends Schema.ConstraintDecoder<unknown>,
  Error extends Schema.ConstraintDecoder<unknown>
>(
  result: DurableObjectResult<A, E>,
  value: Value,
  error: Error
): Effect.Effect<Value["Type"], Error["Type"]> => {
  return Match.value(result).pipe(Match.tagsExhaustive({
    success: ({ value: decoded }) => Effect.succeed(Schema.decodeUnknownSync(value)(decoded)),
    failure: ({ error: encoded }) => Effect.fail(Schema.decodeUnknownSync(error)(encoded)),
    defect: ({ message }) => Effect.die(new Error(message)),
    interrupted: () => Effect.interrupt,
    durableSqlRowLimitExceeded: ({ bytes, limit }) => Effect.die(new DurableSqlRowLimitExceeded({
      bytes,
      limit
    }))
  }))
}

const fromResult = <
  A,
  E,
  Value extends Schema.ConstraintDecoder<unknown>,
  Error extends Schema.ConstraintDecoder<unknown>
>(
  request: (requestId: string) => Promise<DurableObjectResult<A, E>>,
  cancel: (requestId: string) => void,
  value: Value,
  error: Error
): Effect.Effect<Value["Type"], Error["Type"]> =>
  Effect.callback((resume) => {
    const requestId = crypto.randomUUID()
    request(requestId).then(
      (result) => {
        try {
          resume(foldResult(result, value, error))
        } catch (cause) {
          resume(Effect.die(cause))
        }
      },
      (cause) => resume(Effect.die(cause))
    )
    return Effect.sync(() => {
      cancel(requestId)
    }).pipe(Effect.catchCause(() => Effect.void))
  })

const make = (
  namespace: DurableObjectNamespace<CanvasDurableObject>,
  options: DurableObjectAuthorityOptions
): CanvasAuthority["Service"] => {
  const stubFor = (canvasId: Parameters<CanvasAuthority["Service"]["open"]>[0]) =>
    namespace.get(namespace.idFromName(canvasId))

  const create: CanvasAuthority["Service"]["create"] = (command, invocation) =>
    Effect.suspend(() => {
      const ownedCommand = DomainValue.detach(command)
      const ownedInvocation = DomainValue.detach(invocation)
      const stub = stubFor(ownedCommand.canvasId)
      return fromResult(
        (requestId) => stub.create(
          ownedCommand,
          ownedInvocation,
          options.testClockId,
          requestId
        ),
        (requestId) => {
          stubFor(ownedCommand.canvasId).cancel(requestId)
        },
        AuthorityView,
        CanvasAlreadyExists
      )
    })

  const open: CanvasAuthority["Service"]["open"] = (canvasId) =>
    Effect.suspend(() => {
      const stub = stubFor(canvasId)
      return fromResult(
        (requestId) => stub.open(options.testClockId, requestId),
        (requestId) => {
          stubFor(canvasId).cancel(requestId)
        },
        AuthorityView,
        CanvasNotFound
      )
    })

  const submit: CanvasAuthority["Service"]["submit"] = (proposal, invocation) =>
    Effect.suspend(() => {
      const ownedProposal = DomainValue.detach(proposal)
      const ownedInvocation = DomainValue.detach(invocation)
      const { canvasId, ...oneCanvasProposal } = ownedProposal
      const stub = stubFor(canvasId)
      return fromResult(
        (requestId) => stub.submit(
          oneCanvasProposal,
          ownedInvocation,
          options.testClockId,
          requestId
        ),
        (requestId) => {
          stubFor(canvasId).cancel(requestId)
        },
        SubmitChangeReceiptSchema,
        SubmitFailure
      )
    })

  const changesAfter: CanvasAuthority["Service"]["changesAfter"] = (query) =>
    Effect.suspend(() => {
      const ownedQuery = DomainValue.detach(query)
      const { canvasId, ...oneCanvasQuery } = ownedQuery
      const stub = stubFor(canvasId)
      return fromResult(
        (requestId) => stub.changesAfter(
          oneCanvasQuery,
          options.testClockId,
          requestId
        ),
        (requestId) => {
          stubFor(canvasId).cancel(requestId)
        },
        ChangePageSchema,
        ChangesAfterFailure
      )
    })

  return { create, open, submit, changesAfter }
}

export const durableObjectLayer = (
  namespace: DurableObjectNamespace<CanvasDurableObject>,
  options: DurableObjectAuthorityOptions = {}
): Layer.Layer<CanvasAuthority> =>
  Layer.succeed(CanvasAuthority, make(namespace, options))
