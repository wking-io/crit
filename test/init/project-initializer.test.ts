import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  CritInitFailed,
  CritInitializer
} from "../../src/init/project-initializer.js"

const read = (root: string, target: string) =>
  readFile(path.join(root, target), "utf8")

const write = async (root: string, target: string, content: string) => {
  const destination = path.join(root, target)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}

const runInit = (root: string) =>
  Effect.runPromise(
    CritInitializer.init({ root }).pipe(Effect.provide(NodeServices.layer))
  )

describe("CritInitializer", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-init-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("fully configures a React Router framework project and is idempotent", async () => {
    await write(
      root,
      "package.json",
      `${JSON.stringify(
        {
          name: "review-app",
          packageManager: "npm@11.11.0",
          dependencies: {
            "@react-router/dev": "7.8.0",
            react: "19.2.0",
            vite: "7.3.6"
          }
        },
        null,
        2
      )}\n`
    )
    await write(
      root,
      "vite.config.ts",
      `import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()]
})
`
    )
    await write(
      root,
      "app/routes.ts",
      `import { index, type RouteConfig } from "@react-router/dev/routes"

export default [
  index("./routes/home.tsx")
] satisfies RouteConfig
`
    )
    await write(root, ".gitignore", "node_modules/\n")

    const first = await runInit(root)
    const firstSnapshot = {
      packageJson: await read(root, "package.json"),
      vite: await read(root, "vite.config.ts"),
      routes: await read(root, "app/routes.ts"),
      component: await read(root, "app/components/crit-canvas.tsx"),
      route: await read(root, "app/routes/crit.tsx"),
      skill: await read(root, ".agents/skills/crit/SKILL.md"),
      manifest: await read(root, "crit.manifest.json"),
      gitignore: await read(root, ".gitignore")
    }
    const second = await runInit(root)

    expect(first.project).toBe("react-router")
    expect(first.warnings).toEqual([])
    expect(first.install).toEqual({
      command: "npm",
      args: ["install"],
      cwd: root
    })
    expect(JSON.parse(firstSnapshot.packageJson)).toMatchObject({
      dependencies: { "@riff-refine/crit": "^0.0.0" }
    })
    expect(firstSnapshot.vite).toContain(
      `import { crit as critPlugin } from "@riff-refine/crit/vite"`
    )
    expect(firstSnapshot.vite.match(/critPlugin\(\)/g)).toHaveLength(1)
    expect(firstSnapshot.routes).toContain(
      `route("crit/:canvasId?", "./routes/crit.tsx")`
    )
    expect(firstSnapshot.component).toContain("<Crit canvasId={canvasId} />")
    expect(firstSnapshot.route).toContain("useParams")
    expect(firstSnapshot.skill).toContain("name: crit")
    expect(JSON.parse(firstSnapshot.manifest)).toMatchObject({
      schemaVersion: 1,
      id: "review-app",
      canvases: [
        {
          id: "default",
          frames: [{ id: "app", url: "/", status: "in-progress" }]
        }
      ]
    })
    expect(firstSnapshot.gitignore).toBe("node_modules/\n.crit/\n")
    expect(
      second.actions.filter((action) => action.status !== "unchanged")
    ).toEqual([])
    await expect(
      Promise.all(
        Object.entries(firstSnapshot).map(async ([key, value]) => {
          const target =
            key === "packageJson"
              ? "package.json"
              : key === "vite"
                ? "vite.config.ts"
                : key === "routes"
                  ? "app/routes.ts"
                  : key === "component"
                    ? "app/components/crit-canvas.tsx"
                    : key === "route"
                      ? "app/routes/crit.tsx"
                    : key === "skill"
                      ? ".agents/skills/crit/SKILL.md"
                      : key === "manifest"
                        ? "crit.manifest.json"
                      : ".gitignore"
          expect(await read(root, target)).toBe(value)
        })
      )
    ).resolves.toBeDefined()
  })

  it("creates the reusable surface without guessing a generic app's router", async () => {
    await write(
      root,
      "package.json",
      `${JSON.stringify(
        {
          name: "vite-app",
          dependencies: { react: "19.2.0" },
          devDependencies: { vite: "7.3.6" }
        },
        null,
        2
      )}\n`
    )
    await write(
      root,
      "vite.config.ts",
      `import { defineConfig } from "vite"

export default defineConfig({})
`
    )

    const result = await runInit(root)

    expect(result.project).toBe("vite-react")
    expect(result.warnings).toEqual([
      "Mount src/components/crit-canvas.tsx in the project's router; automatic route registration currently supports React Router framework projects."
    ])
    expect(await read(root, "src/components/crit-canvas.tsx")).toContain(
      "CritCanvas"
    )
    expect(await read(root, "vite.config.ts")).toContain(
      "plugins: [critPlugin()]"
    )
  })

  it("does not partially modify an unrecognized Vite configuration", async () => {
    const packageSource = `${JSON.stringify(
      {
        name: "custom-vite-app",
        dependencies: { react: "19.2.0", vite: "7.3.6" }
      },
      null,
      2
    )}\n`
    await write(root, "package.json", packageSource)
    await write(
      root,
      "vite.config.ts",
      `import { defineConfig } from "vite"
import { makeConfig } from "./build/config"

export default defineConfig(makeConfig())
`
    )

    const failure = await Effect.runPromise(
      Effect.flip(
        CritInitializer.init({ root }).pipe(Effect.provide(NodeServices.layer))
      )
    )

    expect(failure).toBeInstanceOf(CritInitFailed)
    expect(failure).toMatchObject({
      operation: "transform",
      path: path.join(root, "vite.config.ts")
    })
    expect(await read(root, "package.json")).toBe(packageSource)
    await expect(read(root, ".gitignore")).rejects.toThrow()
  })
})
