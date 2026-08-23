#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability"

import { main } from "./index.js"

const MessageFailure = Schema.Struct({ message: Schema.String })

const observability = OtlpTracer.layerFromConfig({
  resource: { serviceName: "crit-cli" }
}).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
)

main.pipe(
  Effect.tapError((failure) => Console.error(
    Schema.is(MessageFailure)(failure) ? failure.message : String(failure)
  )),
  Effect.provide(observability),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true })
)
