import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots = [
  path.join(root, "packages"),
  path.join(root, "test"),
  path.join(root, "www")
]

const skippedDirectories = new Set(["dist", "node_modules", "coverage", ".turbo", "build"])

const allowedSamples = [
  'const url = "http://example.com"',
  'include: "**/*.test.ts"',
  'const assetPath = input.path ?? "/*"',
  'expect(html).not.toContain("/* source comment */")',
  "#!/usr/bin/env node\nconst ready = true"
]

const bannedSamples = [
  "const ready = true // leftover",
  "/* block comment */\nconst ready = true",
  "const ready = true\n/* trailing */",
  "export const Node = () => null /* jsx-adjacent */"
]

const scriptKind = (file) => {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

const isShebang = (source, range) => source.startsWith("#!", range.pos)

const commentRanges = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file)
  )
  const seen = new Set()
  const ranges = []
  const consider = (found) => {
    for (const range of found ?? []) {
      if (isShebang(source, range)) continue
      const key = `${range.pos}:${range.end}`
      if (seen.has(key)) continue
      seen.add(key)
      ranges.push(range)
    }
  }
  const visit = (node) => {
    consider(ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()))
    consider(ts.getTrailingCommentRanges(sourceFile.text, node.end))
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  consider(ts.getLeadingCommentRanges(sourceFile.text, 0))
  return ranges
}

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : sourceFiles(target)
    }
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : []
  }))
  return nested.flat()
}

const findings = []

for (const sample of allowedSamples) {
  if (commentRanges("sample.ts", sample).length > 0) {
    findings.push(`check-source-comments allowlist sample matched a comment: ${sample}`)
  }
}

for (const sample of bannedSamples) {
  if (commentRanges("sample.ts", sample).length === 0) {
    findings.push(`check-source-comments missed banned sample: ${sample}`)
  }
}

for (const directory of roots) {
  const files = await sourceFiles(directory)
  for (const file of files) {
    const source = await readFile(file, "utf8")
    const relative = path.relative(root, file)
    for (const range of commentRanges(file, source)) {
      const { line } = sourceFileLocation(source, range.pos)
      findings.push(`${relative}:${line} source comment`)
    }
  }
}

function sourceFileLocation(source, pos) {
  const prefix = source.slice(0, pos)
  const line = prefix.split("\n").length
  return { line }
}

if (findings.length > 0) {
  process.stderr.write(
    [
      "Source comments are banned in packages/, test/, and www/. Rename the code so it reads without them.",
      ...findings.map((finding) => `- ${finding}`),
      ""
    ].join("\n")
  )
  process.exitCode = 1
} else {
  process.stdout.write("No source comments in packages/, test/, or www/.\n")
}
