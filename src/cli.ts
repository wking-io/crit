#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer } from "effect"

import { runCrit } from "./cli/command.js"
import { FileSystemDocumentStore } from "./node/file-system-document-store.js"
import { CritRuntimeLive } from "./runtime/crit-runtime.js"

const documentStoreLayer = FileSystemDocumentStore.layer({ root: process.cwd() })
const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(documentStoreLayer))
const mainLayer = Layer.mergeAll(NodeServices.layer, runtimeLayer)

runCrit(process.argv.slice(2)).pipe(Effect.provide(mainLayer), NodeRuntime.runMain)

