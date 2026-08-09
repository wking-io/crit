#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer } from "effect"

import { runCrit } from "./cli/command.js"
import { FileSystemCanvasRepository } from "./node/file-system-canvas-repository.js"
import { FileSystemAgentActivity } from "./node/file-system-agent-activity.js"
import { FileSystemSnapshotArchive } from "./node/file-system-snapshot-archive.js"
import { SnapshotServiceLive } from "./runtime/snapshot-service.js"

const documentStoreLayer = FileSystemCanvasRepository.layer({ root: process.cwd() })
const agentActivityLayer = FileSystemAgentActivity.layer({ root: process.cwd() })
const snapshotArchiveLayer = FileSystemSnapshotArchive.layer({ root: process.cwd() })
const snapshotServiceLayer = SnapshotServiceLive.pipe(
  Layer.provide(Layer.mergeAll(documentStoreLayer, snapshotArchiveLayer))
)
const mainLayer = Layer.mergeAll(
  NodeServices.layer,
  documentStoreLayer,
  agentActivityLayer,
  snapshotServiceLayer
)

runCrit(process.argv.slice(2)).pipe(Effect.provide(mainLayer), NodeRuntime.runMain)
