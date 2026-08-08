import { fileURLToPath } from "node:url"

import { Effect, FileSystem, Path, Schema } from "effect"

import { CRIT_MANIFEST_FILE } from "../discovery/index.js"
import { PACKAGE_VERSION } from "../version.js"

const PACKAGE_NAME = "@riff-refine/crit"
const VITE_IMPORT = "@riff-refine/crit/vite"
const ROUTE_PATH = "crit/:canvasId?"

export class CritInitFailed extends Schema.TaggedError<CritInitFailed>()(
  "CritInitFailed",
  {
    operation: Schema.String,
    path: Schema.String,
    detail: Schema.String
  }
) {}

export type CritInitAction = {
  readonly path: string
  readonly status: "created" | "updated" | "unchanged" | "preserved"
}

export type CritInstallCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}

export type CritInitResult = {
  readonly schemaVersion: 1
  readonly root: string
  readonly project: "react-router" | "vite-react"
  readonly actions: ReadonlyArray<CritInitAction>
  readonly warnings: ReadonlyArray<string>
  readonly install: CritInstallCommand
}

export type CritInitOptions = {
  readonly root: string
}

type PackageJson = {
  readonly name?: string
  readonly packageManager?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const failure = (
  operation: string,
  target: string,
  cause: unknown
) =>
  new CritInitFailed({
    operation,
    path: target,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const quoteFor = (source: string) =>
  source.match(/from\s+(['"])/)?.[1] === "'" ? "'" : '"'

const pluginLocalName = (source: string) => {
  const imported = source.match(
    /import\s*\{([^}]*)\}\s*from\s*['"]@riff-refine\/crit\/vite['"]/s
  )
  if (imported === null) return undefined
  const alias = imported[1]?.match(
    /\bcrit\s+as\s+([A-Za-z_$][\w$]*)/
  )?.[1]
  if (alias !== undefined) return alias
  return /\bcrit\b/.test(imported[1] ?? "") ? "crit" : undefined
}

export const addCritToViteConfig = (source: string) => {
  let next = source
  let localName = pluginLocalName(next)
  if (localName === undefined) {
    localName = "critPlugin"
    const quote = quoteFor(next)
    next = `import { crit as critPlugin } from ${quote}${VITE_IMPORT}${quote}\n${next}`
  }
  if (new RegExp(`\\b${localName}\\s*\\(`).test(next)) return next

  const plugins = /^(\s*)plugins\s*:\s*\[/m.exec(next)
  if (plugins !== null && plugins.index !== undefined) {
    const insertion = plugins.index + plugins[0].length
    const childIndent = `${plugins[1]}${next.includes("\t") ? "\t" : "  "}`
    return `${next.slice(0, insertion)}\n${childIndent}${localName}(),${next.slice(insertion)}`
  }

  const object = /defineConfig\s*\(\s*\{/.exec(next)
  if (object !== null && object.index !== undefined) {
    const insertion = object.index + object[0].length
    return `${next.slice(0, insertion)}\n  plugins: [${localName}()],${next.slice(insertion)}`
  }

  const exportedObject = /export\s+default\s*\{/.exec(next)
  if (exportedObject !== null && exportedObject.index !== undefined) {
    const insertion = exportedObject.index + exportedObject[0].length
    return `${next.slice(0, insertion)}\n  plugins: [${localName}()],${next.slice(insertion)}`
  }

  return undefined
}

const addCritRoute = (source: string) => {
  if (
    source.includes(`"${ROUTE_PATH}"`) ||
    source.includes(`'${ROUTE_PATH}'`) ||
    source.includes("./routes/crit.tsx")
  ) {
    return source
  }

  let next = source
  const importsRoute =
    /import\s*\{[^}]*\broute\b[^}]*\}\s*from\s*['"]@react-router\/dev\/routes['"]/s.test(
      next
    )
  if (!importsRoute) {
    const quote = quoteFor(next)
    next = `import { route } from ${quote}@react-router/dev/routes${quote}\n${next}`
  }

  const exportedRoutes = /export\s+default\s*\[/.exec(next)
  if (exportedRoutes === null || exportedRoutes.index === undefined) {
    return undefined
  }
  const insertion = exportedRoutes.index + exportedRoutes[0].length
  const indentation = next.includes("\t") ? "\t" : "  "
  const quote = quoteFor(next)
  return `${next.slice(0, insertion)}\n${indentation}route(${quote}${ROUTE_PATH}${quote}, ${quote}./routes/crit.tsx${quote}),${next.slice(insertion)}`
}

const componentTemplate = `import { Crit } from "@riff-refine/crit"

export interface CritCanvasProps {
  readonly canvasId?: string
}

export function CritCanvas({ canvasId = "default" }: CritCanvasProps) {
  return (
    <main style={{ height: "100dvh", width: "100%" }}>
      <Crit canvasId={canvasId} />
    </main>
  )
}
`

const routeTemplate = `import { useParams } from "react-router"

import { CritCanvas } from "../components/crit-canvas"

export default function CritRoute() {
  const { canvasId } = useParams()
  return <CritCanvas canvasId={canvasId ?? "default"} />
}
`

const newViteConfig = `import { crit as critPlugin } from "@riff-refine/crit/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [critPlugin()]
})
`

const manifestTemplate = (packageJson: PackageJson) => {
  const projectName = packageJson.name?.trim() || "app"
  const manifestId =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      id: manifestId,
      canvases: [
        {
          id: "default",
          title: "Default review",
          frames: [
            {
              id: "app",
              url: "/",
              title: projectName
            }
          ]
        }
      ]
    },
    null,
    2
  )}\n`
}

const hasDependency = (packageJson: PackageJson, name: string) =>
  packageJson.dependencies?.[name] !== undefined ||
  packageJson.devDependencies?.[name] !== undefined ||
  packageJson.peerDependencies?.[name] !== undefined

const sortRecord = (record: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  )

const addPackageDependency = (
  packageJson: PackageJson,
  original: string
) => {
  const existing =
    packageJson.dependencies?.[PACKAGE_NAME] ??
    packageJson.devDependencies?.[PACKAGE_NAME]
  if (
    packageJson.dependencies?.[PACKAGE_NAME] !== undefined &&
    packageJson.devDependencies?.[PACKAGE_NAME] === undefined
  ) {
    return original
  }

  packageJson.dependencies = sortRecord({
    ...packageJson.dependencies,
    [PACKAGE_NAME]: existing ?? `^${PACKAGE_VERSION}`
  })
  if (packageJson.devDependencies?.[PACKAGE_NAME] !== undefined) {
    delete packageJson.devDependencies[PACKAGE_NAME]
  }
  const indentation = original.match(/^(\s+)["}]/m)?.[1] ?? "  "
  return `${JSON.stringify(packageJson, null, indentation)}\n`
}

const appendIgnoreRule = (source: string) => {
  if (source.split(/\r?\n/).some((line) => line.trim() === ".crit/")) {
    return source
  }
  const prefix = source.length === 0 || source.endsWith("\n") ? source : `${source}\n`
  return `${prefix}.crit/\n`
}

const installCommand = (
  root: string,
  packageJson: PackageJson,
  lockfiles: ReadonlySet<string>
): CritInstallCommand => {
  const declared = packageJson.packageManager?.split("@")[0]
  const manager =
    declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm"
      ? declared
      : lockfiles.has("pnpm-lock.yaml")
        ? "pnpm"
        : lockfiles.has("yarn.lock")
          ? "yarn"
          : lockfiles.has("bun.lock") || lockfiles.has("bun.lockb")
            ? "bun"
            : "npm"
  return { command: manager, args: ["install"], cwd: root }
}

const reactRouterAppDirectory = (source: string | undefined) =>
  source?.match(/\bappDirectory\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? "app"

const init = (
  options: CritInitOptions
): Effect.Effect<
  CritInitResult,
  CritInitFailed,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = path.resolve(options.root)
    const packagePath = path.join(root, "package.json")

    const packageExists = yield* fs
      .exists(packagePath)
      .pipe(Effect.mapError((cause) => failure("inspect", packagePath, cause)))
    if (!packageExists) {
      return yield* new CritInitFailed({
        operation: "inspect",
        path: packagePath,
        detail: "No package.json was found"
      })
    }

    const packageSource = yield* fs
      .readFileString(packagePath)
      .pipe(Effect.mapError((cause) => failure("read", packagePath, cause)))
    const packageJson = yield* Effect.try({
      try: () => JSON.parse(packageSource) as PackageJson,
      catch: (cause) => failure("parse", packagePath, cause)
    })
    if (!hasDependency(packageJson, "vite") || !hasDependency(packageJson, "react")) {
      return yield* new CritInitFailed({
        operation: "inspect",
        path: packagePath,
        detail: "Crit init currently requires a Vite + React project"
      })
    }

    const exists = (target: string) =>
      fs.exists(target).pipe(
        Effect.mapError((cause) => failure("inspect", target, cause))
      )
    const read = (target: string) =>
      fs.readFileString(target).pipe(
        Effect.mapError((cause) => failure("read", target, cause))
      )

    const configNames = [
      "vite.config.ts",
      "vite.config.mts",
      "vite.config.js",
      "vite.config.mjs"
    ]
    let viteConfigPath: string | undefined
    for (const name of configNames) {
      const candidate = path.join(root, name)
      if (yield* exists(candidate)) {
        viteConfigPath = candidate
        break
      }
    }
    viteConfigPath ??= path.join(root, "vite.config.ts")
    const viteConfigExists = yield* exists(viteConfigPath)
    const viteSource = viteConfigExists ? yield* read(viteConfigPath) : newViteConfig
    const configuredVite = viteConfigExists
      ? addCritToViteConfig(viteSource)
      : viteSource
    if (configuredVite === undefined) {
      return yield* new CritInitFailed({
        operation: "transform",
        path: viteConfigPath,
        detail: "Could not safely locate the Vite plugins array"
      })
    }

    const isReactRouter = hasDependency(packageJson, "@react-router/dev")
    const warnings: Array<string> = []
    let appDirectory = "src"
    let routeConfigPath: string | undefined
    let routeConfigSource: string | undefined
    let configuredRoutes: string | undefined

    if (isReactRouter) {
      const routerConfigNames = [
        "react-router.config.ts",
        "react-router.config.js",
        "react-router.config.mjs"
      ]
      let routerConfigSource: string | undefined
      for (const name of routerConfigNames) {
        const candidate = path.join(root, name)
        if (yield* exists(candidate)) {
          routerConfigSource = yield* read(candidate)
          break
        }
      }
      appDirectory = reactRouterAppDirectory(routerConfigSource)
      routeConfigPath = path.join(root, appDirectory, "routes.ts")
      if (yield* exists(routeConfigPath)) {
        routeConfigSource = yield* read(routeConfigPath)
        configuredRoutes = addCritRoute(routeConfigSource)
        if (configuredRoutes === undefined) {
          warnings.push(
            `Register ${ROUTE_PATH} with ./${appDirectory}/routes/crit.tsx; the route config shape was not recognized.`
          )
        }
      } else {
        warnings.push(
          `Register ${ROUTE_PATH} with ./${appDirectory}/routes/crit.tsx; no ${appDirectory}/routes.ts was found.`
        )
      }
    } else {
      warnings.push(
        "Mount src/components/crit-canvas.tsx in the project's router; automatic route registration currently supports React Router framework projects."
      )
    }

    const skillSourcePath = fileURLToPath(
      new URL("../../skills/crit/SKILL.md", import.meta.url)
    )
    const skillSource = yield* read(skillSourcePath)
    const writes = new Map<string, string>()
    const actions: Array<CritInitAction> = []

    const planManaged = (
      target: string,
      before: string | undefined,
      after: string
    ) => {
      const relative = path.relative(root, target)
      if (before === after) {
        actions.push({ path: relative, status: "unchanged" })
        return
      }
      writes.set(target, after)
      actions.push({
        path: relative,
        status: before === undefined ? "created" : "updated"
      })
    }

    const planGenerated = function*(target: string, content: string) {
      const relative = path.relative(root, target)
      if (!(yield* exists(target))) {
        writes.set(target, content)
        actions.push({ path: relative, status: "created" })
        return
      }
      const current = yield* read(target)
      if (current === content) {
        actions.push({ path: relative, status: "unchanged" })
        return
      }
      actions.push({ path: relative, status: "preserved" })
      warnings.push(`Preserved existing ${relative}; merge Crit setup manually.`)
    }

    planManaged(
      packagePath,
      packageSource,
      addPackageDependency(packageJson, packageSource)
    )
    planManaged(
      viteConfigPath,
      viteConfigExists ? viteSource : undefined,
      configuredVite
    )

    const gitignorePath = path.join(root, ".gitignore")
    const gitignoreExists = yield* exists(gitignorePath)
    const gitignoreSource = gitignoreExists ? yield* read(gitignorePath) : undefined
    planManaged(
      gitignorePath,
      gitignoreSource,
      appendIgnoreRule(gitignoreSource ?? "")
    )

    const componentPath = path.join(
      root,
      appDirectory,
      "components",
      "crit-canvas.tsx"
    )
    yield* planGenerated(componentPath, componentTemplate)

    if (isReactRouter) {
      const routePath = path.join(root, appDirectory, "routes", "crit.tsx")
      yield* planGenerated(routePath, routeTemplate)
      if (
        routeConfigPath !== undefined &&
        routeConfigSource !== undefined &&
        configuredRoutes !== undefined
      ) {
        planManaged(routeConfigPath, routeConfigSource, configuredRoutes)
      }
    }

    const skillPath = path.join(root, ".agents", "skills", "crit", "SKILL.md")
    yield* planGenerated(skillPath, skillSource)

    const manifestPath = path.join(root, CRIT_MANIFEST_FILE)
    yield* planGenerated(manifestPath, manifestTemplate(packageJson))

    for (const [target, content] of writes) {
      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(Effect.mapError((cause) => failure("mkdir", target, cause)))
      yield* fs
        .writeFileString(target, content)
        .pipe(Effect.mapError((cause) => failure("write", target, cause)))
    }

    const lockfiles = new Set<string>()
    for (const name of [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb"
    ]) {
      if (yield* exists(path.join(root, name))) lockfiles.add(name)
    }

    return {
      schemaVersion: 1,
      root,
      project: isReactRouter ? "react-router" : "vite-react",
      actions,
      warnings,
      install: installCommand(root, packageJson, lockfiles)
    }
  })

export const CritInitializer = { init } as const
