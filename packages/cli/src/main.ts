#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Schema } from "effect"

import { main } from "./index.js"

const MessageFailure = Schema.Struct({ message: Schema.String })

main.pipe(
  Effect.tapError((failure) => Console.error(
    Schema.is(MessageFailure)(failure) ? failure.message : String(failure)
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true })
)
