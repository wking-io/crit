import { CanvasCamera, CanvasSelection } from "../src/index.js"

export const defaultCamera = CanvasCamera.make({ x: 0, y: 0, zoom: 1 })
export const defaultSelection = CanvasSelection.make([])

export const ignoreCameraChange = (
  _camera: ReturnType<typeof CanvasCamera.make>
) => undefined

export const ignoreSelectionChange = (
  _selection: ReturnType<typeof CanvasSelection.make>
) => undefined

export const requiredBoard = {
  camera: defaultCamera,
  onCameraChange: ignoreCameraChange,
  onSelectionChange: ignoreSelectionChange,
  selection: defaultSelection
}
