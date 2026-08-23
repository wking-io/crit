import {
  FileSystemArtifactStore,
  FileSystemArtifactStoreOpenFailure,
  type FileSystemArtifactStoreOptions
} from "@crit/representations/adapter"
import { NodeCrypto, NodeFileSystem, NodePath } from "@effect/platform-node"
import { Layer } from "effect"

export { FileSystemArtifactStoreOpenFailure }

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)

export const LocalArtifactStore = {
  layer: (options: FileSystemArtifactStoreOptions) =>
    FileSystemArtifactStore.layer(options).pipe(Layer.provide(platformLayer))
}
