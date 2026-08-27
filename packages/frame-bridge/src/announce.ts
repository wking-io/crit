import { readFileSync } from "node:fs"
import path from "node:path"

import { decodeCritProjectManifestV2 } from "@crit/protocol"
import { Option, Schema } from "effect"

export const critApplicationIdentityPath = "/.well-known/crit.json"
export const localApplicationAnnouncePath = "/api/v1/applications/announce"

const daemonDescriptorFile = path.join(".crit", "v1", "daemon.json")

export const readProjectApplicationId = (root: string): string | undefined => {
  try {
    return decodeCritProjectManifestV2(
      JSON.parse(readFileSync(path.join(root, "crit.manifest.json"), "utf8"))
    ).applicationId
  } catch {
    return undefined
  }
}

const DaemonAnnounceTarget = Schema.Struct({
  version: Schema.Literal(1),
  instance: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
  baseUrl: Schema.String.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:[0-9]+$/))
})

const parseDaemonAnnounceTarget = (
  contents: string
): { readonly instance: string; readonly baseUrl: string } | undefined => {
  try {
    const parsed = Option.getOrUndefined(
      Schema.decodeUnknownOption(DaemonAnnounceTarget)(JSON.parse(contents))
    )
    if (parsed === undefined) return undefined
    return { instance: parsed.instance, baseUrl: parsed.baseUrl }
  } catch {
    return undefined
  }
}

export const readLocalDaemonAnnounceTarget = (
  start: string
): { readonly instance: string; readonly baseUrl: string } | undefined => {
  let directory = path.resolve(start)
  for (;;) {
    let parsed: ReturnType<typeof parseDaemonAnnounceTarget>
    try {
      parsed = parseDaemonAnnounceTarget(
        readFileSync(path.join(directory, daemonDescriptorFile), "utf8")
      )
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined) return parsed
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

export const applicationOriginFromHref = (href: string): string | undefined => {
  try {
    const url = new URL(href)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return `${url.origin}/`
  } catch {
    return undefined
  }
}

export const announceLocalApplication = async (input: {
  readonly applicationId: string
  readonly origin: string
  readonly instance: string
  readonly daemonBaseUrl: string
}): Promise<void> => {
  await fetch(`${input.daemonBaseUrl}${localApplicationAnnouncePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crit-api-version": "1"
    },
    body: JSON.stringify({
      schemaVersion: 1,
      applicationId: input.applicationId,
      origin: input.origin,
      instance: input.instance
    })
  })
}
