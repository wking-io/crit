import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Schema } from "effect"
import ts from "typescript"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const packagesRoot = path.join(root, "packages")
const alphaSourceRoot = path.join(root, "src")

const allowedDependencies = new Map([
  ["domain", []],
  ["protocol", ["domain"]],
  ["authority", ["domain", "protocol"]],
  ["replica", ["domain", "protocol", "authority"]],
  ["representations", ["domain"]],
  ["client", ["domain", "protocol", "authority", "replica", "representations"]],
  ["react", ["domain", "protocol", "replica", "representations", "frame-bridge"]],
  ["host", ["client", "react", "domain", "replica"]],
  ["frame-bridge", ["protocol"]],
  ["local", ["domain", "protocol", "authority", "replica", "representations", "client"]],
  ["cloudflare", ["domain", "protocol", "authority", "representations"]],
  ["cli", ["domain", "replica", "representations", "client", "local"]]
])

const targetNames = new Set(allowedDependencies.keys())
const expectedNames = [...targetNames].sort()
const publishedPackages = new Set([
  "authority",
  "client",
  "domain",
  "frame-bridge",
  "protocol",
  "react",
  "replica",
  "representations"
])
const errors = []
const isString = Schema.is(Schema.String)
const isProjectReference = Schema.is(Schema.Struct({ path: Schema.String }))

const json = async (file) => JSON.parse(await readFile(file, "utf8"))

const sameItems = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())

const within = (parent, candidate) => {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.[cm]?tsx?$/.test(entry.name) ? [target] : []
  }))
  return nested.flat()
}

const workspaceName = (specifier) =>
  /^@crit\/([^/]+)(?:\/|$)/.exec(specifier)?.[1]

const platformImport = (specifier) =>
  specifier.startsWith("node:") ||
  specifier.startsWith("cloudflare:") ||
  specifier.startsWith("@cloudflare/") ||
  specifier.startsWith("@effect/platform") ||
  specifier === "react" ||
  specifier.startsWith("react/") ||
  specifier === "react-dom" ||
  specifier.startsWith("react-dom/") ||
  specifier === "vite" ||
  specifier.startsWith("vite/")

const targetNameForDirectory = (directory) => {
  const relative = path.relative(packagesRoot, path.resolve(directory))
  const [name, ...rest] = relative.split(path.sep)
  return rest.length === 0 && targetNames.has(name) ? name : undefined
}

const referenceNames = (config, configFile) => {
  const names = []
  for (const reference of config.references ?? []) {
    if (!isProjectReference(reference)) {
      errors.push(`${path.relative(root, configFile)} has a reference without a path`)
      continue
    }
    const referenceDirectory = path.resolve(path.dirname(configFile), reference.path)
    const name = targetNameForDirectory(referenceDirectory)
    if (name === undefined) {
      errors.push(
        `${path.relative(root, configFile)} references non-target project ${reference.path}`
      )
      continue
    }
    names.push(name)
  }
  return names
}

const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

if (!sameItems(packageDirectories, expectedNames)) {
  errors.push(
    `Target packages must be exactly ${expectedNames.join(", ")}; found ${packageDirectories.join(", ")}`
  )
}

const rootManifest = await json(path.join(root, "package.json"))
const workspacePatterns = rootManifest.workspaces
if (!Array.isArray(workspacePatterns) || workspacePatterns.some((item) => !isString(item))) {
  errors.push("Root package.json workspaces must be an array of target package paths")
} else {
  const workspaceNames = []
  for (const pattern of workspacePatterns) {
    if (pattern === "packages/*") {
      workspaceNames.push(...packageDirectories)
      continue
    }
    const match = /^packages\/([^/*]+)$/.exec(pattern)
    if (match === null) {
      errors.push(`Unsupported target workspace pattern ${pattern}`)
      continue
    }
    workspaceNames.push(match[1])
  }
  if (!sameItems(workspaceNames, expectedNames)) {
    errors.push(
      `Root workspaces must resolve to exactly ${expectedNames.join(", ")}; resolved ${[...new Set(workspaceNames)].sort().join(", ")}`
    )
  }
}

const targetConfigFile = path.join(root, "tsconfig.target.json")
const targetConfig = await json(targetConfigFile)
const targetReferences = referenceNames(targetConfig, targetConfigFile)
if (!sameItems(targetReferences, expectedNames)) {
  errors.push(
    `tsconfig.target.json must reference exactly ${expectedNames.join(", ")}; found ${[...new Set(targetReferences)].sort().join(", ")}`
  )
}

const manifests = new Map()
const dependencyGraph = new Map()

for (const name of expectedNames) {
  const directory = path.join(packagesRoot, name)
  const manifestFile = path.join(directory, "package.json")
  const configFile = path.join(directory, "tsconfig.json")
  let manifest
  let config
  try {
    manifest = await json(manifestFile)
    config = await json(configFile)
  } catch (cause) {
    errors.push(`Cannot read scaffold for packages/${name}: ${String(cause)}`)
    continue
  }
  manifests.set(name, manifest)
  if (manifest.name !== `@crit/${name}`) {
    errors.push(`packages/${name} must be named @crit/${name}`)
  }
  if (publishedPackages.has(name)) {
    if (manifest.private === true) {
      errors.push(`@crit/${name} must be publishable`)
    }
    if (manifest.license !== "MIT") {
      errors.push(`@crit/${name} must declare the MIT license`)
    }
    if (manifest.publishConfig?.access !== "public") {
      errors.push(`@crit/${name} must publish with public access`)
    }
  } else if (manifest.private !== true) {
    errors.push(`@crit/${name} must remain private`)
  }

  const declared = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies
  }
  const declaredTargets = []
  for (const dependency of Object.keys(declared)) {
    const dependencyName = workspaceName(dependency)
    if (dependencyName === undefined) continue
    if (!targetNames.has(dependencyName)) {
      errors.push(`@crit/${name} declares unknown target dependency ${dependency}`)
      continue
    }
    declaredTargets.push(dependencyName)
    if (!allowedDependencies.get(name).includes(dependencyName)) {
      errors.push(`@crit/${name} may not depend on ${dependency}`)
    }
  }
  dependencyGraph.set(name, declaredTargets)

  const references = referenceNames(config, configFile)
  if (!sameItems(references, declaredTargets)) {
    errors.push(
      `@crit/${name} TypeScript references must match declared workspace dependencies; declared ${declaredTargets.sort().join(", ") || "none"}, referenced ${references.sort().join(", ") || "none"}`
    )
  }

  const readConfig = ts.readConfigFile(configFile, ts.sys.readFile)
  if (readConfig.error !== undefined) {
    errors.push(ts.flattenDiagnosticMessageText(readConfig.error.messageText, "\n"))
    continue
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    readConfig.config,
    ts.sys,
    directory,
    undefined,
    configFile
  )
  for (const diagnostic of parsedConfig.errors) {
    errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
  }
  if (name === "domain" || name === "protocol") {
    const forbiddenLib = (parsedConfig.options.lib ?? []).find((lib) =>
      /lib\.dom(?:\.iterable)?\.d\.ts$/i.test(lib)
    )
    if (forbiddenLib !== undefined || (parsedConfig.options.types ?? []).includes("node")) {
      errors.push(`packages/${name} may not include DOM or Node globals`)
    }
  }

  const packageRoot = path.resolve(directory)
  const srcRoot = path.join(packageRoot, "src")
  let files = []
  try {
    files = await sourceFiles(srcRoot)
  } catch (cause) {
    errors.push(`Cannot inspect packages/${name}/src: ${String(cause)}`)
  }
  for (const file of files) {
    const source = await readFile(file, "utf8")
    const imports = ts.preProcessFile(source, true, true).importedFiles
    for (const imported of imports) {
      const specifier = imported.fileName
      if (specifier === "@riff-refine/crit" || specifier.startsWith("@riff-refine/crit/")) {
        errors.push(`${path.relative(root, file)} imports forbidden alpha package ${specifier}`)
      }

      const dependencyName = workspaceName(specifier)
      if (dependencyName !== undefined) {
        if (!targetNames.has(dependencyName)) {
          errors.push(`${path.relative(root, file)} imports unknown target package ${specifier}`)
        } else if (!allowedDependencies.get(name).includes(dependencyName)) {
          errors.push(`${path.relative(root, file)} may not import ${specifier}`)
        } else if (!declaredTargets.includes(dependencyName)) {
          errors.push(`${path.relative(root, file)} imports undeclared dependency @crit/${dependencyName}`)
        }
      }

      if (specifier.startsWith(".")) {
        const resolvedRelative = path.resolve(path.dirname(file), specifier)
        if (!within(packageRoot, resolvedRelative)) {
          errors.push(`${path.relative(root, file)} escapes its package through ${specifier}`)
        }
      }
      if ((name === "domain" || name === "protocol") && platformImport(specifier)) {
        errors.push(`${path.relative(root, file)} imports forbidden platform module ${specifier}`)
      }

      const resolution = ts.resolveModuleName(
        specifier,
        file,
        parsedConfig.options,
        ts.sys
      ).resolvedModule
      if (dependencyName !== undefined && resolution === undefined) {
        errors.push(`${path.relative(root, file)} cannot resolve target import ${specifier}`)
      }
      if (resolution !== undefined) {
        const resolvedFile = path.resolve(resolution.resolvedFileName)
        if (within(alphaSourceRoot, resolvedFile)) {
          errors.push(
            `${path.relative(root, file)} resolves ${specifier} into forbidden alpha source ${path.relative(root, resolvedFile)}`
          )
        }
        if (within(packagesRoot, resolvedFile)) {
          const resolvedRelative = path.relative(packagesRoot, resolvedFile)
          const resolvedPackage = resolvedRelative.split(path.sep)[0]
          if (resolvedPackage !== name && !declaredTargets.includes(resolvedPackage)) {
            errors.push(
              `${path.relative(root, file)} resolves ${specifier} into undeclared package @crit/${resolvedPackage}`
            )
          }
        }
      }
    }
  }
}

const visiting = new Set()
const visited = new Set()
const visit = (name, route) => {
  if (visiting.has(name)) {
    errors.push(`Target dependency cycle: ${[...route, name].join(" -> ")}`)
    return
  }
  if (visited.has(name)) return
  visiting.add(name)
  for (const dependency of dependencyGraph.get(name) ?? []) {
    visit(dependency, [...route, name])
  }
  visiting.delete(name)
  visited.add(name)
}

for (const name of expectedNames) visit(name, [])

if (errors.length > 0) {
  process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`)
  process.exitCode = 1
} else {
  const graph = expectedNames.map((name) => {
    const dependencies = dependencyGraph.get(name) ?? []
    return `${name} -> ${dependencies.length === 0 ? "none" : dependencies.map((dependency) => `@crit/${dependency}`).join(", ")}`
  })
  process.stdout.write(`Target package boundaries valid.\n${graph.join("\n")}\n`)
}
