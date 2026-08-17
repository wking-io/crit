import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const usage = "npm run import:glyph -- --source <nucleo-svg-path> --name <kebab-case-name>"

const option = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const sourceArgument = option("--source")
const name = option("--name")

if (sourceArgument === undefined || name === undefined) {
  throw new Error(`Missing required arguments. Usage: ${usage}`)
}
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
  throw new Error(`Glyph name must be semantic kebab-case: ${name}`)
}

const source = path.resolve(sourceArgument)
const iconsDirectory = path.dirname(source)
const familyDirectory = path.dirname(iconsDirectory)
const family = path.basename(familyDirectory)
const id = path.basename(source, ".svg")

if (path.basename(iconsDirectory) !== "icons" || family !== "ui" || !/^\d+$/.test(id)) {
  throw new Error("Source must be a numeric SVG from a Nucleo ui/icons directory")
}

const catalogPath = path.join(familyDirectory, "icons.json")
const catalog = JSON.parse(await readFile(catalogPath, "utf8"))
const icon = catalog.icons?.find((candidate) => String(candidate.id) === id)

if (icon === undefined) {
  throw new Error(`Nucleo UI catalog does not contain icon id ${id}`)
}
if (!icon.fills?.includes("outline-duo") || !icon.sizes?.includes("18px")) {
  throw new Error(`${icon.label ?? id} is not Nucleo UI Outline Duo 18px`)
}

const svg = (await readFile(source, "utf8")).trim()
const openingTag = svg.match(/^<svg\b[^>]*>/)?.[0]
if (openingTag === undefined || !/\bviewBox=(['"])0 0 18 18\1/.test(openingTag)) {
  throw new Error(`${source} must contain one 18-by-18 SVG root`)
}

const normalizedOpeningTag = openingTag.replace(/\s(?:width|height)=(['"])[^'"]*\1/g, "")
const normalizedSvg = svg.replace(openingTag, normalizedOpeningTag)
const safeLabel = String(icon.label ?? id).replaceAll("--", "-")
const targetDirectory = path.join(process.cwd(), "src/glyphs/icons")
const target = path.join(targetDirectory, `${name}.svg`)

if (existsSync(target)) {
  throw new Error(`Glyph already exists: ${target}`)
}

await mkdir(targetDirectory, { recursive: true })
await writeFile(
  target,
  `<!-- Nucleo UI Outline Duo 18 | label: ${safeLabel} | id: ${id} -->\n${normalizedSvg}\n`,
  "utf8"
)

console.log(`Imported ${icon.label} as ${path.relative(process.cwd(), target)}`)
console.log("Next: run npm run generate:glyphs")
