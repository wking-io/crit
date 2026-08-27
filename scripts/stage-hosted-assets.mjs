import { execFile } from "node:child_process"
import { cp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Schema } from "effect"

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const cloudflareRoot = path.join(repositoryRoot, "packages/cloudflare")
const hostOutput = path.join(repositoryRoot, "packages/host/dist-web")
const wranglerConfigPath = path.join(cloudflareRoot, "wrangler.jsonc")
const WranglerAssetsConfig = Schema.Struct({
  env: Schema.Struct({
    production: Schema.Struct({
      assets: Schema.Struct({
        directory: Schema.String.check(Schema.isNonEmpty())
      })
    })
  })
})

const jsoncToJson = (contents) => contents
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

const productionAssetsDirectory = async() => {
  const contents = await readFile(wranglerConfigPath, "utf8")
  const config = Schema.decodeUnknownSync(WranglerAssetsConfig)(
    JSON.parse(jsoncToJson(contents))
  )
  return path.resolve(cloudflareRoot, config.env.production.assets.directory)
}

export const assertBuiltShell = (html) => {
  if (html.includes("/src/")) {
    throw new Error("Built host shell must not reference /src/")
  }
  const hasHashedModule = (html.match(/<script\b[^>]*>/gi) ?? []).some((tag) => {
    if (!/\btype=["']module["']/i.test(tag)) return false
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    return src !== undefined &&
      /^\/assets\/[^/?#]+-[A-Za-z0-9_-]{6,}\.js(?:[?#].*)?$/.test(src)
  })
  if (!hasHashedModule) {
    throw new Error("Built host shell must reference a hashed /assets/*.js module script")
  }
}

const stageHostedAssets = async() => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  await execFileAsync(npm, ["run", "build", "--workspace", "@crit/host"], {
    cwd: repositoryRoot
  })
  assertBuiltShell(await readFile(path.join(hostOutput, "index.html"), "utf8"))
  const target = await productionAssetsDirectory()
  await rm(target, { recursive: true, force: true })
  await cp(hostOutput, target, { recursive: true })
}

const entrypoint = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(path.resolve(process.argv[1])).href

if (entrypoint === import.meta.url) await stageHostedAssets()
