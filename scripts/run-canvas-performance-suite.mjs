#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const alphaUrl = process.env.CRIT_ALPHA_PERF_URL ?? "http://127.0.0.1:5174/?crit-perf=1&profile=alpha"
const v1Url = process.env.CRIT_V1_PERF_URL ?? "http://127.0.0.1:5173/canvas/canvas_performance_lab_v2?crit-perf=1"
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
const outputDirectory = resolve(process.argv[2] ?? `.artifacts/canvas-performance/${stamp}`)
mkdirSync(outputDirectory, { recursive: true })

const measure = (url, label) => JSON.parse(execFileSync(
  process.execPath,
  ["scripts/measure-canvas-performance.mjs", url, label],
  { cwd: resolve("."), encoding: "utf8" }
))

const alpha = measure(alphaUrl, "alpha")
const v1 = measure(v1Url, "v1")
const checks = [
  {
    name: "pan FPS is within 2 FPS of alpha",
    pass: v1.wheel.fps >= alpha.wheel.fps - 2,
    alpha: alpha.wheel.fps,
    v1: v1.wheel.fps
  },
  {
    name: "pan p95 frame time is within 20% of alpha",
    pass: v1.wheel.p95FrameMs <= alpha.wheel.p95FrameMs * 1.2,
    alpha: alpha.wheel.p95FrameMs,
    v1: v1.wheel.p95FrameMs
  },
  {
    name: "pan has no frames over 32ms",
    pass: v1.wheel.framesOver32Ms === 0,
    alpha: alpha.wheel.framesOver32Ms,
    v1: v1.wheel.framesOver32Ms
  },
  {
    name: "pan does not produce more React commits than alpha",
    pass: v1.wheel.reactCommits <= alpha.wheel.reactCommits,
    alpha: alpha.wheel.reactCommits,
    v1: v1.wheel.reactCommits
  },
  {
    name: "v1 mounts no more live iframes than alpha",
    pass: v1.page.frames <= alpha.page.frames,
    alpha: alpha.page.frames,
    v1: v1.page.frames
  },
  {
    name: "v1 interactive controls are labeled",
    pass: v1.page.unlabeledControls === 0,
    alpha: alpha.page.unlabeledControls,
    v1: v1.page.unlabeledControls
  }
]
const result = {
  passed: checks.every((check) => check.pass),
  generatedAt: new Date().toISOString(),
  alphaUrl,
  v1Url,
  checks
}

writeFileSync(resolve(outputDirectory, "alpha.json"), `${JSON.stringify(alpha, null, 2)}\n`)
writeFileSync(resolve(outputDirectory, "v1.json"), `${JSON.stringify(v1, null, 2)}\n`)
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ outputDirectory, ...result }, null, 2))
if (!result.passed) process.exitCode = 1
