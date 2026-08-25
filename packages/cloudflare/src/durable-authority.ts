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
import { Effect, Layer, Schema } from "effect"

import { CanvasDurableObject } from "./canvas-object.js"
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
const ResultEnvelope = Schema.Union([
  Schema.TaggedStruct("success", { value: Schema.Unknown }),
  Schema.TaggedStruct("failure", { error: Schema.Unknown }),
  Schema.TaggedStruct("defect", { message: Schema.String }),
  Schema.TaggedStruct("interrupted", {}),
  Schema.TaggedStruct("durable-sql-row-limit-exceeded", {
    bytes: Schema.Number,
    limit: Schema.Number
  })
])

const decodeResult = <A, E>(
  input: unknown,
  decodeSuccess: (input: unknown) => A,
  decodeFailure: (input: unknown) => E
): Effect.Effect<A, E> => {
  const result = Schema.decodeUnknownSync(ResultEnvelope)(input)
  switch (result._tag) {
    case "success":
      return Effect.succeed(decodeSuccess(result.value))
    case "failure":
      return Effect.fail(decodeFailure(result.error))
    case "defect":
      return Effect.die(new Error(result.message))
    case "interrupted":
      return Effect.interrupt
    case "durable-sql-row-limit-exceeded":
      return Effect.die(new DurableSqlRowLimitExceeded({
        bytes: result.bytes,
        limit: result.limit
      }))
  }
}

const fromResult = <A, E>(
  request: (requestId: string) => Promise<unknown>,
  cancel: (requestId: string) => Promise<void>,
  decodeSuccess: (input: unknown) => A,
  decodeFailure: (input: unknown) => E
): Effect.Effect<A, E> => Effect.callback<A, E>((resume) => {
  const requestId = crypto.randomUUID()
  request(requestId).then(
    (result) => {
      try {
        resume(decodeResult(result, decodeSuccess, decodeFailure))
      } catch (cause) {
        resume(Effect.die(cause))
      }
    },
    (cause) => resume(Effect.die(cause))
  )
  return Effect.promise(() => cancel(requestId)).pipe(
    Effect.catchCause(() => Effect.void)
  )
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
      return fromResult((requestId) => stub.create(
        ownedCommand,
        ownedInvocation,
        options.testClockId,
        requestId
      ), (requestId) => stubFor(ownedCommand.canvasId).cancel(requestId),
      Schema.decodeUnknownSync(AuthorityView),
      Schema.decodeUnknownSync(CanvasAlreadyExists))
    })

  const open: CanvasAuthority["Service"]["open"] = (canvasId) =>
    Effect.suspend(() => {
      const stub = stubFor(canvasId)
      return fromResult(
        (requestId) => stub.open(options.testClockId, requestId),
        (requestId) => stubFor(canvasId).cancel(requestId),
        Schema.decodeUnknownSync(AuthorityView),
        Schema.decodeUnknownSync(CanvasNotFound)
      )
    })

  const submit: CanvasAuthority["Service"]["submit"] = (proposal, invocation) =>
    Effect.suspend(() => {
      const ownedProposal = DomainValue.detach(proposal)
      const ownedInvocation = DomainValue.detach(invocation)
      const { canvasId, ...oneCanvasProposal } = ownedProposal
      const stub = stubFor(canvasId)
      return fromResult((requestId) => stub.submit(
        oneCanvasProposal,
        ownedInvocation,
        options.testClockId,
        requestId
      ), (requestId) => stubFor(canvasId).cancel(requestId),
      Schema.decodeUnknownSync(SubmitChangeReceiptSchema),
      Schema.decodeUnknownSync(SubmitFailure))
    })

  const changesAfter: CanvasAuthority["Service"]["changesAfter"] = (query) =>
    Effect.suspend(() => {
      const ownedQuery = DomainValue.detach(query)
      const { canvasId, ...oneCanvasQuery } = ownedQuery
      const stub = stubFor(canvasId)
      return fromResult((requestId) => stub.changesAfter(
        oneCanvasQuery,
        options.testClockId,
        requestId
      ), (requestId) => stubFor(canvasId).cancel(requestId),
      Schema.decodeUnknownSync(ChangePageSchema),
      Schema.decodeUnknownSync(ChangesAfterFailure))
    })

  return { create, open, submit, changesAfter }
}

export const durableObjectLayer = (
  namespace: DurableObjectNamespace<CanvasDurableObject>,
  options: DurableObjectAuthorityOptions = {}
): Layer.Layer<CanvasAuthority> =>
  Layer.succeed(CanvasAuthority, make(namespace, options))
