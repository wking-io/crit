import {
  CanvasId,
  CanvasTitle,
  Id,
  ImportId,
  PersonId,
  Sha256Digest,
  ShareId,
  WorkspaceId
} from "@crit/domain"
import { ShareDigestMismatch } from "@crit/protocol"
import { Data, Schema } from "effect"

const createShareTableSql = `
CREATE TABLE IF NOT EXISTS canvas_shares (
  share_id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL UNIQUE,
  canvas_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  projection_digest TEXT NOT NULL,
  title TEXT NOT NULL
) STRICT;
`

export const defaultWorkspaceId = Id.workspace("workspace_default")

export const ShareReceiptRow = Schema.Struct({
  shareId: ShareId,
  importId: ImportId,
  canvasId: CanvasId,
  workspaceId: WorkspaceId,
  personId: PersonId,
  projectionDigest: Sha256Digest,
  title: CanvasTitle
})
export type ShareReceiptRow = typeof ShareReceiptRow.Type

export const ShareReceiptMismatch = Schema.TaggedStruct("shareReceiptMismatch", {
  shareId: ShareId
})
export type ShareReceiptMismatch = typeof ShareReceiptMismatch.Type

export const ShareReceiptRequest = Schema.Struct({
  shareId: ShareId,
  importId: ImportId,
  canvasId: CanvasId,
  personId: PersonId,
  projectionDigest: Sha256Digest,
  title: CanvasTitle
})
export type ShareReceiptRequest = typeof ShareReceiptRequest.Type

export type ComparedShareReceipt = Data.TaggedEnum<{
  readonly match: { readonly receipt: ShareReceiptRow }
  readonly digestMismatch: { readonly mismatch: ShareDigestMismatch }
  readonly receiptMismatch: { readonly mismatch: ShareReceiptMismatch }
}>
export const ComparedShareReceipt = Data.taggedEnum<ComparedShareReceipt>()

const shareSelectSql = `
  SELECT
    share_id AS shareId,
    import_id AS importId,
    canvas_id AS canvasId,
    workspace_id AS workspaceId,
    person_id AS personId,
    projection_digest AS projectionDigest,
    title
  FROM canvas_shares
  WHERE share_id = ?
`

export const ensureShareTable = async (env: Cloudflare.Env) => {
  await env.CONTROL.prepare(createShareTableSql).run()
}

export const lookupShareReceipt = async (
  env: Cloudflare.Env,
  shareId: ShareId
): Promise<ShareReceiptRow | undefined> => {
  await ensureShareTable(env)
  const result = await env.CONTROL.prepare(shareSelectSql).bind(shareId).first()
  return result === null
    ? undefined
    : Schema.decodeUnknownSync(ShareReceiptRow)(result)
}

export const compareShareReceipt = (
  stored: ShareReceiptRow,
  requested: ShareReceiptRequest
): ComparedShareReceipt => {
  if (stored.projectionDigest !== requested.projectionDigest) {
    return ComparedShareReceipt.digestMismatch({
      mismatch: ShareDigestMismatch.make({
        shareId: requested.shareId,
        expectedDigest: stored.projectionDigest,
        receivedDigest: requested.projectionDigest
      })
    })
  }
  if (
    stored.importId !== requested.importId ||
    stored.canvasId !== requested.canvasId ||
    stored.personId !== requested.personId
  ) {
    return ComparedShareReceipt.receiptMismatch({
      mismatch: ShareReceiptMismatch.make({ shareId: requested.shareId })
    })
  }
  return ComparedShareReceipt.match({ receipt: stored })
}

export const insertShareReceipt = async (
  env: Cloudflare.Env,
  requested: ShareReceiptRequest
): Promise<ShareReceiptRow> => {
  await ensureShareTable(env)
  await env.CONTROL.prepare(`
    INSERT INTO canvas_shares (
      share_id,
      import_id,
      canvas_id,
      workspace_id,
      person_id,
      projection_digest,
      title
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    requested.shareId,
    requested.importId,
    requested.canvasId,
    defaultWorkspaceId,
    requested.personId,
    requested.projectionDigest,
    requested.title
  ).run()
  return ShareReceiptRow.make({
    shareId: requested.shareId,
    importId: requested.importId,
    canvasId: requested.canvasId,
    workspaceId: defaultWorkspaceId,
    personId: requested.personId,
    projectionDigest: requested.projectionDigest,
    title: requested.title
  })
}
