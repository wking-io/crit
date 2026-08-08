import { Store, type StoreSnapshot } from "@tldraw/store"
import {
  PageRecordType,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  createTLSchema,
  defaultShapeSchemas,
  type TLAssetStore,
  type TLBaseShape,
  type TLRecord,
  type TLSchema
} from "@tldraw/tlschema"
import type { IndexKey } from "@tldraw/utils"
import { T } from "@tldraw/validate"

const frameStatuses = ["in-progress", "approved", "changes-requested"] as const

type CritFrameProps = {
  readonly w: number
  readonly h: number
  readonly url: string
  readonly title: string
  readonly status: (typeof frameStatuses)[number]
  readonly provenance: {
    readonly kind: "manual" | "agent" | "manifest" | "discovery"
    readonly sourceId: string
  }
  readonly display: {
    readonly heightMode: "viewport" | "fit-page"
  }
}

export type CritFrame = TLBaseShape<"crit-frame", CritFrameProps>

const frameVersions = createShapePropsMigrationIds("crit-frame", {
  AddProvenance: 1,
  AddDisplay: 2
})

const frameMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: frameVersions.AddProvenance,
      up: (props) => {
        props.provenance = { kind: "manual", sourceId: "legacy" }
      },
      down: (props) => {
        delete props.provenance
      }
    },
    {
      id: frameVersions.AddDisplay,
      up: (props) => {
        props.display = { heightMode: "viewport" }
      },
      down: (props) => {
        delete props.display
      }
    }
  ]
})

const annotationShapeSchemas = {
  arrow: defaultShapeSchemas.arrow,
  draw: defaultShapeSchemas.draw,
  geo: defaultShapeSchemas.geo,
  group: defaultShapeSchemas.group,
  highlight: defaultShapeSchemas.highlight,
  line: defaultShapeSchemas.line,
  note: defaultShapeSchemas.note,
  text: defaultShapeSchemas.text
}

export const critSchema = createTLSchema({
  shapes: {
    ...annotationShapeSchemas,
    "crit-frame": {
      props: {
        w: T.number,
        h: T.number,
        url: T.string,
        title: T.string,
        status: T.literalEnum(...frameStatuses),
        provenance: T.object({
          kind: T.literalEnum("manual", "agent", "manifest", "discovery"),
          sourceId: T.string
        }),
        display: T.object({
          heightMode: T.literalEnum("viewport", "fit-page")
        })
      },
      migrations: frameMigrations
    }
  }
})

const disabledAssets: Required<TLAssetStore> = {
  async upload() {
    throw new Error("Assets are unsupported in Crit V1")
  },
  resolve() {
    return null
  },
  async remove() {}
}

export const makeStore = (
  schema: TLSchema = critSchema,
  initialData?: Record<string, TLRecord>
) => {
  const base = {
    schema,
    props: {
      defaultName: "Crit Canvas",
      assets: disabledAssets,
      onMount() {}
    }
  }

  return new Store(initialData === undefined ? base : { ...base, initialData })
}

export const makePage = (canvasId: string, title: string) =>
  PageRecordType.create({
    id: PageRecordType.createId(canvasId),
    name: title,
    index: "a1" as IndexKey,
    meta: {}
  })

export const assertNoAssets = (snapshot: StoreSnapshot<TLRecord>) => {
  for (const record of Object.values(snapshot.store)) {
    if (record.typeName === "asset") {
      throw new Error("Asset records are unsupported in Crit V1")
    }
  }
}

export const isCritFrame = (record: TLRecord): record is CritFrame =>
  record.typeName === "shape" && record.type === "crit-frame"
