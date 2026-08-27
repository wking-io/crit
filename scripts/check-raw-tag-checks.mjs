import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots = [path.join(root, "packages"), path.join(root, "test")]

const banned = [
  {
    id: "compare",
    description: "raw `_tag` comparison",
    pattern: /\._tag\s*(===|!==|==|!=)/u
  },
  {
    id: "expect-toBe",
    description: "raw `_tag` assertion",
    pattern: /expect\s*\([\s\S]*?\._tag[\s\S]*?\)\s*\.\s*(?:not\s*\.\s*)?toBe\s*\(/u
  },
  {
    id: "switch",
    description: "raw `_tag` switch",
    pattern: /switch\s*\(\s*[^)]*\._tag/u
  }
]

const allowedSamples = [
  'expect(result).toEqual({ _tag: "applied", projection })',
  'expect(missing).toMatchObject({ _tag: "CritClientNotFound" })',
  'const value = { _tag: "ready" as const }',
  'type Applied = Extract<Result, { readonly _tag: "applied" }>',
  "yield* Console.log(`${result._tag}  ${result.path}`)",
  '"data-crit-help-kind": details._tag',
  "representation: frame.representation._tag",
  'Schema.TaggedStruct("replayed", { projection: CanvasProjection })',
  'Match.tagsExhaustive({ replayed: ({ projection }) => projection })',
  'Predicate.isTagged(result, "replayed")',
  'ReplicaSession.$is("ready")(session)',
  "if (Result.isFailure(result)) return result"
]

const bannedSamples = [
  'if (result._tag === "replayed") return',
  'if (result._tag !== "replayed") return',
  'if (value._tag == "ready") return',
  'if (value._tag != "ready") return',
  'if (status?._tag === "conflicted") return',
  'expect(plan._tag).toBe("iframe")',
  'expect(result.failure._tag).toBe("envelopeInvalid")',
  'expect(action?._tag).not.toBe("batch")',
  "switch (effect._tag) {",
  'expect(Result.isSuccess(x) && x.success._tag).toBe("Y")'
]

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.[cm]?tsx?$/.test(entry.name) ? [target] : []
  }))
  return nested.flat()
}

const findings = []

for (const sample of allowedSamples) {
  const hit = banned.find((rule) => rule.pattern.test(sample))
  if (hit !== undefined) {
    findings.push(`check-raw-tag-checks allowlist sample matched ${hit.id}: ${sample}`)
  }
}

for (const sample of bannedSamples) {
  if (!banned.some((rule) => rule.pattern.test(sample))) {
    findings.push(`check-raw-tag-checks missed banned sample: ${sample}`)
  }
}

for (const directory of roots) {
  const files = await sourceFiles(directory)
  for (const file of files) {
    const source = await readFile(file, "utf8")
    const relative = path.relative(root, file)
    for (const rule of banned) {
      rule.pattern.lastIndex = 0
      if (!rule.pattern.test(source)) continue
      const lines = source.split("\n")
      lines.forEach((line, index) => {
        rule.pattern.lastIndex = 0
        if (rule.pattern.test(line)) {
          findings.push(`${relative}:${index + 1} ${rule.description}`)
        }
      })
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    [
      "Raw `_tag` checks are banned. Use Predicate.isTagged, Match, Effect.catchTag, taggedEnum `$is`, Result.isSuccess/isFailure, or Option.isSome/isNone.",
      ...findings.map((finding) => `- ${finding}`),
      ""
    ].join("\n")
  )
  process.exitCode = 1
} else {
  process.stdout.write("No raw `_tag` checks in packages/ or test/.\n")
}
