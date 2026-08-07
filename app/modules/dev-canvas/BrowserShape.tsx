import { Tooltip } from '@base-ui/react/tooltip'
import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
} from '@tldraw/tlschema'
import { AnimatePresence, motion } from 'motion/react'
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import {
	BaseBoxShapeTool,
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	stopEventPropagation,
	useEditor,
	useValue,
} from 'tldraw'
import type { Editor, TLBaseShape, TLShape } from 'tldraw'
import {
	FRAME_STATUSES,
	IconEditTitle,
	IconFullscreen,
	IconMinimize,
	IconOpenExternal,
	IconSaveTitle,
	IconSnapshot,
	IconTrash,
	frameStatus,
	formatFrameChromeTitle,
	shortIdForIndex,
} from './frame-chrome'
import { parseDevCanvasHeightMessage } from './frame-height-bridge.client'
import { CANVAS_ITEM_STATUSES } from './model'
import type { CanvasItemStatus } from './model'

export type BrowserShape = TLBaseShape<
	'dev-browser',
	{
		w: number
		h: number
		itemId: string
		url: string
		title: string
		source: string
		status: CanvasItemStatus
	}
>

type BrowserShapeActions = {
	remove(itemId: string): void
	setStatus(itemId: string, status: CanvasItemStatus): void
	setTitle(itemId: string, title: string): void
	snapshot(itemId: string): Promise<boolean>
	commitDraft(shape: BrowserShape, url: string): Promise<boolean>
}

const BrowserShapeActionsContext = createContext<BrowserShapeActions>({
	remove() {},
	setStatus() {},
	setTitle() {},
	async snapshot() {
		return false
	},
	async commitDraft() {
		return false
	},
})

export const BROWSER_FRAME_TOOL_ID = 'dev-browser-frame'

const FRAME_VERTICAL_CHROME = 28
const FRAME_ROW_GAP = 80
const FRAME_COLUMN_GAP = 80
const FRAME_COLUMNS = 2
const FRAME_INITIAL_HEIGHT = 580
const FRAME_LOAD_TIMEOUT = 12_000
const FRAME_LAYOUT_ORIGIN = 120
const FRAME_CORNER_RADIUS = 8
const STATUS_PILL_HEIGHT = 24
const STATUS_PILL_RADIUS = 8
const STATUS_PILL_STEP = 40
const STATUS_PILL_CHROME_WIDTH = 40
const STATUS_PILL_CHARACTER_WIDTH = 6.5
const STATUS_PILL_MOTION = {
	spring: { type: 'spring', visualDuration: 0.25, bounce: 0.3 },
	curve: -55,
	curveExponent: 1.85,
	originOffset: 38,
	initialScale: 0.5,
	gap: 6,
	frameGap: 6,
} as const

let statusPillMeasurementContext: CanvasRenderingContext2D | null

function measureStatusPillWidth(label: string) {
	if (typeof document === 'undefined') {
		return STATUS_PILL_CHROME_WIDTH + label.length * STATUS_PILL_CHARACTER_WIDTH
	}
	statusPillMeasurementContext ??= document
		.createElement('canvas')
		.getContext('2d')
	if (!statusPillMeasurementContext) {
		return STATUS_PILL_CHROME_WIDTH + label.length * STATUS_PILL_CHARACTER_WIDTH
	}
	statusPillMeasurementContext.font =
		'400 12px system-ui, -apple-system, sans-serif'
	return (
		STATUS_PILL_CHROME_WIDTH +
		statusPillMeasurementContext.measureText(label).width
	)
}

function roundedRectangleSupport(
	width: number,
	height: number,
	radius: number,
	angle: number,
	axisX: number,
	axisY: number,
) {
	const cosine = Math.cos(angle)
	const sine = Math.sin(angle)
	const localAxisX = cosine * axisX + sine * axisY
	const localAxisY = -sine * axisX + cosine * axisY
	const localSupportX =
		Math.sign(localAxisX) * (width / 2 - radius) + radius * localAxisX
	const localSupportY =
		Math.sign(localAxisY) * (height / 2 - radius) + radius * localAxisY
	return {
		x: cosine * localSupportX - sine * localSupportY,
		y: sine * localSupportX + cosine * localSupportY,
	}
}

type StatusPillLayoutItem = {
	distanceFromFrame: number
	finalRotate: number
	angle: number
	width: number
	verticalHalfExtent: number
	finalX: number
	centerX: number
	centerY: number
	finalY: number
}

export function calculateStatusPillLayout(widths: number[]) {
	const layout: StatusPillLayoutItem[] = widths.map((width, index) => {
		const distanceFromFrame = widths.length - index
		const curveScale = distanceFromFrame / widths.length
		const curveSlope =
			(STATUS_PILL_MOTION.curve *
				STATUS_PILL_MOTION.curveExponent *
				Math.pow(curveScale, STATUS_PILL_MOTION.curveExponent - 1)) /
			(widths.length * STATUS_PILL_STEP)
		const finalRotate = Math.atan(curveSlope) * (180 / Math.PI)
		const angle = (finalRotate * Math.PI) / 180
		const verticalHalfExtent = roundedRectangleSupport(
			width,
			STATUS_PILL_HEIGHT,
			STATUS_PILL_RADIUS,
			angle,
			0,
			1,
		).y
		return {
			distanceFromFrame,
			finalRotate,
			angle,
			width,
			verticalHalfExtent,
			finalX: 0,
			centerX: 0,
			centerY: 0,
			finalY: 0,
		}
	})
	const bottomIndex = layout.length - 1
	const bottomItem = layout[bottomIndex]
	if (bottomItem) {
		bottomItem.finalX =
			STATUS_PILL_MOTION.curve *
			Math.pow(
				bottomItem.distanceFromFrame / widths.length,
				STATUS_PILL_MOTION.curveExponent,
			)
		bottomItem.centerX = bottomItem.finalX + bottomItem.width / 2
		bottomItem.centerY = STATUS_PILL_HEIGHT / 2 + bottomIndex * STATUS_PILL_STEP
	}
	for (let index = bottomIndex - 1; index >= 0; index -= 1) {
		const item = layout[index]
		const lowerItem = layout[index + 1]
		if (!item || !lowerItem) continue
		const averageAngle = (item.angle + lowerItem.angle) / 2
		const normalX = Math.sin(averageAngle)
		const normalY = -Math.cos(averageAngle)
		const itemSupport = roundedRectangleSupport(
			item.width,
			STATUS_PILL_HEIGHT,
			STATUS_PILL_RADIUS,
			item.angle,
			normalX,
			normalY,
		)
		const lowerItemSupport = roundedRectangleSupport(
			lowerItem.width,
			STATUS_PILL_HEIGHT,
			STATUS_PILL_RADIUS,
			lowerItem.angle,
			normalX,
			normalY,
		)
		// The two support vectors reach the facing rounded edges. Adding
		// gap * normal makes their closest points exactly `gap` pixels apart.
		item.centerX =
			lowerItem.centerX +
			itemSupport.x +
			lowerItemSupport.x +
			normalX * STATUS_PILL_MOTION.gap
		item.finalX = item.centerX - item.width / 2
		item.centerY =
			lowerItem.centerY +
			itemSupport.y +
			lowerItemSupport.y +
			normalY * STATUS_PILL_MOTION.gap
	}
	for (let index = 0; index < layout.length; index += 1) {
		const item = layout[index]
		if (!item) continue
		const baseCenter = STATUS_PILL_HEIGHT / 2 + index * STATUS_PILL_STEP
		item.finalY = item.centerY - baseCenter
	}
	return layout
}

export const BrowserShapeActionsProvider = BrowserShapeActionsContext.Provider

const BrowserShapeVersions = createShapePropsMigrationIds('dev-browser', {
	AddStatus: 1,
})

export const browserShapeMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: BrowserShapeVersions.AddStatus,
			up: (props) => {
				props.status = 'in-progress'
			},
			down: (props) => {
				delete props.status
			},
		},
	],
})

export class BrowserShapeUtil extends BaseBoxShapeUtil<BrowserShape> {
	static override type = 'dev-browser' as const

	static override props = {
		w: T.number,
		h: T.number,
		itemId: T.string,
		url: T.string,
		title: T.string,
		source: T.string,
		status: T.literalEnum(...CANVAS_ITEM_STATUSES),
	}

	static override migrations = browserShapeMigrations

	override getDefaultProps(): BrowserShape['props'] {
		return {
			w: 880,
			h: 580,
			itemId: '',
			url: 'about:blank',
			title: 'Untitled',
			source: 'manual',
			status: 'in-progress',
		}
	}

	override canResize() {
		return true
	}

	override component(shape: BrowserShape) {
		return <BrowserShapeView shape={shape} />
	}

	override indicator(shape: BrowserShape) {
		return (
			<rect
				width={shape.props.w}
				height={shape.props.h}
				rx={FRAME_CORNER_RADIUS}
				ry={FRAME_CORNER_RADIUS}
				stroke={frameStatus(shape.props.status).ink}
			/>
		)
	}
}

export class BrowserFrameTool extends BaseBoxShapeTool {
	static override id = BROWSER_FRAME_TOOL_ID
	static override initial = 'idle'
	override shapeType = BrowserShapeUtil.type

	override onCreate(shape: TLShape | null) {
		if (!shape || shape.type !== BrowserShapeUtil.type) return
		const browserShape = shape as BrowserShape
		this.editor.updateShape<BrowserShape>({
			id: browserShape.id,
			type: BrowserShapeUtil.type,
			props: {
				w: Math.max(360, browserShape.props.w),
				h: Math.max(240, browserShape.props.h),
			},
		})
		this.editor.setCurrentTool('select.idle')
	}
}

function BrowserShapeView({ shape }: { shape: BrowserShape }) {
	const actions = useContext(BrowserShapeActionsContext)
	const editor = useEditor()
	const isDraft = shape.props.itemId === ''
	const isSnapshot = shape.props.source === 'snapshot'
	const iframeIsInteractive = useValue(
		'dev canvas iframe is interactive',
		() => !isDraft && editor.getCurrentToolId() === 'select',
		[editor, isDraft],
	)
	const frameRef = useRef<HTMLDivElement>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const statusButtonRef = useRef<HTMLButtonElement>(null)
	const statusMenuRef = useRef<HTMLDivElement>(null)
	const titleEditorRef = useRef<HTMLDivElement>(null)
	const titleInputRef = useRef<HTMLInputElement>(null)
	const stopObservingHeight = useRef<null | (() => void)>(null)
	const actionTooltip = useMemo(() => Tooltip.createHandle<string>(), [])
	const [fullscreen, setFullscreen] = useState(false)
	const [statusMenuOpen, setStatusMenuOpen] = useState(false)
	const [titleEditing, setTitleEditing] = useState(false)
	const [titleDraft, setTitleDraft] = useState(shape.props.title)
	const [snapshotting, setSnapshotting] = useState(false)
	const [draftUrl, setDraftUrl] = useState('')
	const [draftError, setDraftError] = useState('')
	const [draftSubmitting, setDraftSubmitting] = useState(false)
	const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>(
		'loading',
	)
	const [autoSized, setAutoSized] = useState(false)

	useEffect(() => {
		const onFullscreenChange = () => {
			setFullscreen(document.fullscreenElement === frameRef.current)
		}
		document.addEventListener('fullscreenchange', onFullscreenChange)
		return () =>
			document.removeEventListener('fullscreenchange', onFullscreenChange)
	}, [])

	useEffect(() => {
		return () => stopObservingHeight.current?.()
	}, [])

	useEffect(() => {
		if (!statusMenuOpen) return
		const closeOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target as Node
			if (
				statusButtonRef.current?.contains(target) ||
				statusMenuRef.current?.contains(target)
			) {
				return
			}
			setStatusMenuOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setStatusMenuOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOnOutsidePointer)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [statusMenuOpen])

	const cancelTitleEdit = useCallback(() => {
		setTitleDraft(shape.props.title)
		setTitleEditing(false)
	}, [shape.props.title])

	const saveTitleEdit = useCallback(() => {
		const title = titleDraft.trim()
		if (title && title !== shape.props.title) {
			actions.setTitle(shape.props.itemId, title)
		}
		setTitleEditing(false)
	}, [actions, shape.props.itemId, shape.props.title, titleDraft])

	useEffect(() => {
		if (!titleEditing) return
		titleInputRef.current?.focus()
		titleInputRef.current?.select()

		const cancelOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target
			if (target instanceof Node && titleEditorRef.current?.contains(target)) {
				return
			}
			cancelTitleEdit()
		}
		document.addEventListener('pointerdown', cancelOnOutsidePointer, true)
		return () =>
			document.removeEventListener('pointerdown', cancelOnOutsidePointer, true)
	}, [cancelTitleEdit, titleEditing])

	useEffect(() => {
		stopObservingHeight.current?.()
		stopObservingHeight.current = null
		if (isDraft) return
		setLoadState('loading')
		setAutoSized(false)
		const timeout = window.setTimeout(() => {
			setLoadState((current) => (current === 'loading' ? 'failed' : current))
		}, FRAME_LOAD_TIMEOUT)
		return () => window.clearTimeout(timeout)
	}, [isDraft, shape.props.url])

	useEffect(() => {
		if (!isDraft) return
		const animationFrame = window.requestAnimationFrame(() => {
			frameRef.current?.querySelector<HTMLInputElement>('input')?.focus()
		})
		return () => window.cancelAnimationFrame(animationFrame)
	}, [isDraft])

	const applyDocumentHeight = useCallback(
		(documentHeight: number) => {
			const nextHeight = Math.ceil(documentHeight) + FRAME_VERTICAL_CHROME
			const currentShape = editor.getShape(shape.id) as BrowserShape | undefined
			if (!currentShape || currentShape.type !== 'dev-browser') return
			if (Math.abs(currentShape.props.h - nextHeight) > 1) {
				editor.updateShape<BrowserShape>({
					id: shape.id,
					type: 'dev-browser',
					props: { h: nextHeight },
				})
				scheduleBrowserShapeLayout(editor)
			}
			setAutoSized(true)
		},
		[editor, shape.id],
	)

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return
			const message = parseDevCanvasHeightMessage(event.data)
			if (!message) return
			try {
				if (event.origin !== new URL(shape.props.url).origin) return
			} catch {
				return
			}
			setLoadState('loaded')
			setAutoSized(true)
			if (message.documentHeight > message.viewportHeight + 1) {
				applyDocumentHeight(message.documentHeight)
			}
		}
		window.addEventListener('message', onMessage)
		return () => window.removeEventListener('message', onMessage)
	}, [applyDocumentHeight, shape.props.url])

	const handleLoad = useCallback(() => {
		setLoadState('loaded')
		stopObservingHeight.current?.()
		const currentShape = editor.getShape(shape.id) as BrowserShape | undefined
		if (
			currentShape?.type === 'dev-browser' &&
			currentShape.props.h !== FRAME_INITIAL_HEIGHT
		) {
			editor.updateShape<BrowserShape>({
				id: shape.id,
				type: 'dev-browser',
				props: { h: FRAME_INITIAL_HEIGHT },
			})
			scheduleBrowserShapeLayout(editor)
		}
		stopObservingHeight.current = observeIframeDocumentHeight(
			iframeRef.current,
			applyDocumentHeight,
		)
		setAutoSized(Boolean(stopObservingHeight.current))
	}, [applyDocumentHeight, editor, shape.id])

	const toggleFullscreen = async () => {
		if (document.fullscreenElement === frameRef.current) {
			await document.exitFullscreen()
			return
		}
		await frameRef.current?.requestFullscreen()
	}

	const frameIndex = getOrderedBrowserShapes(editor).findIndex(
		(item) => item.id === shape.id,
	)
	const shortId = shortIdForIndex(frameIndex < 0 ? 0 : frameIndex)
	const status = frameStatus(shape.props.status)
	const StatusIcon = status.icon
	const chromeTitle = formatFrameChromeTitle(shortId, shape.props.title)
	const availableStatuses = FRAME_STATUSES.filter(
		(option) => option.id !== status.id,
	)
	const statusPillLayout = calculateStatusPillLayout(
		availableStatuses.map((option) => measureStatusPillWidth(option.label)),
	).map((layout, index) => ({
		...layout,
		option: availableStatuses[index]!,
	}))
	const rotatedBottomHalfHeight =
		statusPillLayout.at(-1)?.verticalHalfExtent ?? STATUS_PILL_HEIGHT / 2
	const statusFrameGap =
		STATUS_PILL_MOTION.frameGap +
		Math.max(0, rotatedBottomHalfHeight - STATUS_PILL_HEIGHT / 2)
	const beginTitleEdit = () => {
		setStatusMenuOpen(false)
		setTitleDraft(shape.props.title)
		setTitleEditing(true)
	}
	const submitDraft = async (event: React.FormEvent) => {
		event.preventDefault()
		event.stopPropagation()
		if (!draftUrl.trim() || draftSubmitting) return
		setDraftSubmitting(true)
		setDraftError('')
		const committed = await actions.commitDraft(shape, draftUrl)
		if (!committed) {
			setDraftSubmitting(false)
			setDraftError('Could not add this URL.')
		}
	}
	const takeSnapshot = async () => {
		if (snapshotting || isDraft || isSnapshot) return
		setSnapshotting(true)
		await actions.snapshot(shape.props.itemId)
		setSnapshotting(false)
	}

	return (
		<HTMLContainer
			className="dev-browser-container"
			style={{
				width: shape.props.w,
				height: shape.props.h,
				pointerEvents: 'all',
			}}
		>
			<div
				ref={statusMenuRef}
				className="dev-browser__status-menu"
				role="menu"
				aria-label={`Set status for ${shape.props.title}`}
				onPointerDown={stopEventPropagation}
				style={{
					bottom: `calc(100% + ${statusFrameGap}px)`,
					pointerEvents: !isDraft && statusMenuOpen ? 'all' : 'none',
				}}
			>
				<AnimatePresence>
					{!isDraft && statusMenuOpen
						? statusPillLayout.map(
								({
									option,
									distanceFromFrame,
									finalX,
									finalY,
									finalRotate,
								}) => {
									const OptionIcon = option.icon
									const startY =
										distanceFromFrame * STATUS_PILL_STEP +
										STATUS_PILL_MOTION.originOffset
									const selectStatus = () => {
										actions.setStatus(shape.props.itemId, option.id)
										setStatusMenuOpen(false)
									}
									return (
										<motion.button
											key={option.id}
											type="button"
											role="menuitemradio"
											aria-checked={option.id === status.id}
											className="dev-browser__status-option"
											style={{
												['--status-ink' as string]: option.ink,
												['--status-shell' as string]: option.shell,
												['--status-stroke' as string]: option.stroke,
											}}
											initial={{
												opacity: 0,
												scale: STATUS_PILL_MOTION.initialScale,
												y: startY,
												rotate: 0,
											}}
											animate={{
												opacity: 1,
												scale: 1,
												x: finalX,
												y: finalY,
												rotate: [0, finalRotate],
											}}
											exit={{
												opacity: 0,
												scale: STATUS_PILL_MOTION.initialScale,
												y: startY,
												rotate: 0,
											}}
											transition={{
												...STATUS_PILL_MOTION.spring,
												opacity: { duration: 0.12 },
											}}
											onPointerDown={(event) => {
												event.currentTarget.setPointerCapture(event.pointerId)
											}}
											onPointerUp={(event) => {
												if (!event.isPrimary || event.button !== 0) return
												selectStatus()
											}}
											onClick={(event) => {
												if (event.detail === 0) selectStatus()
											}}
										>
											<OptionIcon />
											<span>{option.label}</span>
										</motion.button>
									)
								},
							)
						: null}
				</AnimatePresence>
			</div>
			<div
				ref={frameRef}
				className="dev-browser"
				data-status={status.id}
				style={{
					width: shape.props.w,
					height: shape.props.h,
					['--frame-ink' as string]: status.ink,
					['--frame-shell' as string]: status.shell,
					['--frame-stroke' as string]: status.stroke,
				}}
			>
				<div className="dev-browser__chrome">
					<div className="dev-browser__identity">
						<button
							ref={statusButtonRef}
							type="button"
							className="dev-browser__mark"
							aria-label={`Status: ${status.label}. Change status`}
							aria-haspopup="menu"
							aria-expanded={statusMenuOpen}
							disabled={isDraft}
							onPointerDown={stopEventPropagation}
							onClick={() => setStatusMenuOpen((open) => !open)}
						>
							<StatusIcon />
						</button>
						<span
							className="dev-browser__title-mask"
							data-editing={titleEditing || undefined}
							title={titleEditing ? undefined : chromeTitle}
						>
							{isDraft ? (
								<span className="dev-browser__draft-title">{chromeTitle}</span>
							) : titleEditing ? (
								<div
									ref={titleEditorRef}
									className="dev-browser__title-editor"
									onPointerDown={stopEventPropagation}
									onBlur={(event) => {
										const nextFocus = event.relatedTarget
										if (
											nextFocus instanceof Node &&
											event.currentTarget.contains(nextFocus)
										) {
											return
										}
										cancelTitleEdit()
									}}
								>
									<span className="dev-browser__title-prefix">{shortId}:</span>
									<span
										className="dev-browser__title-input-sizer"
										data-value={titleDraft || ' '}
									>
										<input
											ref={titleInputRef}
											aria-label="Frame title"
											autoComplete="off"
											spellCheck="false"
											value={titleDraft}
											onChange={(event) => setTitleDraft(event.target.value)}
											onKeyDown={(event) => {
												event.stopPropagation()
												if (event.key === 'Enter') {
													event.preventDefault()
													saveTitleEdit()
												}
												if (event.key === 'Escape') {
													event.preventDefault()
													cancelTitleEdit()
												}
											}}
										/>
									</span>
									<button
										type="button"
										className="dev-browser__title-save"
										aria-label="Save frame title"
										onClick={saveTitleEdit}
									>
										<IconSaveTitle />
									</button>
								</div>
							) : (
								<button
									type="button"
									className="dev-browser__title-trigger"
									aria-label={`Edit frame title: ${shape.props.title}`}
									onPointerDown={stopEventPropagation}
									onClick={beginTitleEdit}
								>
									<span className="dev-browser__title-track">
										<strong>{chromeTitle}</strong>
										<strong>{status.label}</strong>
									</span>
									<IconEditTitle className="dev-browser__title-edit-icon" />
								</button>
							)}
						</span>
					</div>
					<div
						className="dev-browser__actions"
						onPointerDown={stopEventPropagation}
					>
						<Tooltip.Provider delay={450} closeDelay={80}>
							{isDraft ? null : (
								<>
									{isSnapshot ? null : (
										<Tooltip.Trigger
											handle={actionTooltip}
											payload={
												snapshotting ? 'Taking snapshot…' : 'Take snapshot'
											}
											aria-label={
												snapshotting ? 'Taking snapshot' : 'Take snapshot'
											}
											type="button"
											disabled={snapshotting}
											data-snapshotting={snapshotting || undefined}
											onClick={() => void takeSnapshot()}
										>
											<IconSnapshot />
										</Tooltip.Trigger>
									)}
									<Tooltip.Trigger
										handle={actionTooltip}
										payload="Open in a new tab"
										aria-label="Open in a new tab"
										render={
											<a
												href={shape.props.url}
												target="_blank"
												rel="noreferrer"
											/>
										}
									>
										<IconOpenExternal />
									</Tooltip.Trigger>
									<Tooltip.Trigger
										handle={actionTooltip}
										payload={
											fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'
										}
										aria-label={
											fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'
										}
										type="button"
										onClick={() => void toggleFullscreen()}
									>
										{fullscreen ? <IconMinimize /> : <IconFullscreen />}
									</Tooltip.Trigger>
								</>
							)}
							<Tooltip.Trigger
								handle={actionTooltip}
								payload="Remove from canvas"
								aria-label="Remove from canvas"
								type="button"
								onClick={() => {
									if (isDraft) {
										editor.deleteShape(shape.id)
									} else {
										actions.remove(shape.props.itemId)
									}
								}}
							>
								<IconTrash />
							</Tooltip.Trigger>

							<Tooltip.Root handle={actionTooltip}>
								{({ payload }) => (
									<Tooltip.Portal>
										<Tooltip.Positioner
											className="dev-browser-tooltip__positioner"
											side="top"
											sideOffset={8}
											style={{
												['--tooltip-ink' as string]: status.ink,
											}}
										>
											<Tooltip.Popup className="dev-browser-tooltip__popup">
												<Tooltip.Arrow className="dev-browser-tooltip__arrow">
													<svg
														width="8"
														height="4"
														viewBox="0 0 8 4"
														aria-hidden="true"
													>
														<path d="M0 0L4 4L8 0Z" />
													</svg>
												</Tooltip.Arrow>
												<Tooltip.Viewport className="dev-browser-tooltip__viewport">
													{payload}
												</Tooltip.Viewport>
											</Tooltip.Popup>
										</Tooltip.Positioner>
									</Tooltip.Portal>
								)}
							</Tooltip.Root>
						</Tooltip.Provider>
					</div>
				</div>
				<div className="dev-browser__viewport">
					{isDraft ? (
						<form
							className="dev-browser__draft"
							onSubmit={(event) => void submitDraft(event)}
							onPointerDown={stopEventPropagation}
							onKeyDown={(event) => {
								event.stopPropagation()
								if (event.key === 'Escape') {
									event.preventDefault()
									editor.deleteShape(shape.id)
								}
							}}
						>
							<label htmlFor={`dev-browser-url-${shape.id}`}>
								Enter the URL for this frame
							</label>
							<div>
								<input
									id={`dev-browser-url-${shape.id}`}
									type="text"
									inputMode="url"
									autoComplete="off"
									placeholder="https://example.com"
									value={draftUrl}
									disabled={draftSubmitting}
									onChange={(event) => setDraftUrl(event.target.value)}
								/>
								<button
									type="submit"
									disabled={!draftUrl.trim() || draftSubmitting}
								>
									{draftSubmitting ? 'Adding…' : 'Add frame'}
								</button>
							</div>
							{draftError ? <span role="alert">{draftError}</span> : null}
							<small>Press Escape to cancel</small>
						</form>
					) : null}
					{!isDraft && loadState === 'loading' ? (
						<div className="dev-browser__loading">
							<span />
							Loading {shape.props.title}
						</div>
					) : null}
					{!isDraft && loadState === 'failed' ? (
						<div
							className="dev-browser__failure"
							role="alert"
							onPointerDown={stopEventPropagation}
						>
							<strong>Couldn’t load this iteration.</strong>
							<span>The app may be offline or blocking iframe access.</span>
							<a href={shape.props.url} target="_blank" rel="noreferrer">
								Open in a new tab ↗
							</a>
						</div>
					) : null}
					{isDraft ? null : (
						<iframe
							ref={iframeRef}
							src={shape.props.url}
							title={shape.props.title}
							tabIndex={iframeIsInteractive ? 0 : -1}
							onLoad={handleLoad}
							onError={() => setLoadState('failed')}
							scrolling={autoSized ? 'no' : 'auto'}
							allow="clipboard-read; clipboard-write; fullscreen"
							referrerPolicy="no-referrer"
							style={{
								pointerEvents: iframeIsInteractive ? 'auto' : 'none',
							}}
						/>
					)}
				</div>
			</div>
		</HTMLContainer>
	)
}

function observeIframeDocumentHeight(
	iframe: HTMLIFrameElement | null,
	onHeight: (height: number) => void,
) {
	if (!iframe) return null

	let iframeDocument: Document
	try {
		iframeDocument = iframe.contentDocument as Document
		void iframeDocument.documentElement
	} catch {
		return null
	}
	if (!iframeDocument?.documentElement) return null

	const root = iframeDocument.documentElement
	const body = iframeDocument.body
	const measure = () => {
		const documentHeight = Math.max(
			root.scrollHeight,
			root.offsetHeight,
			body?.scrollHeight ?? 0,
			body?.offsetHeight ?? 0,
		)
		const viewportHeight = iframe.clientHeight
		if (documentHeight > viewportHeight + 1) onHeight(documentHeight)
	}

	const resizeObserver = new ResizeObserver(measure)
	resizeObserver.observe(root)
	if (body) resizeObserver.observe(body)

	const mutationObserver = new MutationObserver(measure)
	mutationObserver.observe(root, {
		attributes: true,
		childList: true,
		subtree: true,
		characterData: true,
	})

	let animationFrame = requestAnimationFrame(() => {
		measure()
		animationFrame = requestAnimationFrame(measure)
	})
	void iframeDocument.fonts?.ready.then(measure)

	return () => {
		cancelAnimationFrame(animationFrame)
		resizeObserver.disconnect()
		mutationObserver.disconnect()
	}
}

const pendingLayouts = new WeakMap<Editor, number>()

export function organizeBrowserShapes(editor: Editor) {
	const selectedShapes = editor
		.getSelectedShapes()
		.filter((item): item is BrowserShape => item.type === 'dev-browser')
	const organizingSelection = selectedShapes.length > 0
	const shapes = organizingSelection
		? orderBrowserShapes(selectedShapes)
		: getOrderedBrowserShapes(editor)
	if (shapes.length === 0) return

	const originX = organizingSelection
		? Math.min(...shapes.map((item) => item.x))
		: FRAME_LAYOUT_ORIGIN
	const selectionWidth =
		Math.max(...shapes.map((item) => item.x + item.props.w)) - originX
	const widestShape = Math.max(...shapes.map((item) => item.props.w))
	const columns =
		organizingSelection && selectionWidth < widestShape + FRAME_COLUMN_GAP / 2
			? 1
			: FRAME_COLUMNS
	let rowY = organizingSelection
		? Math.min(...shapes.map((item) => item.y))
		: FRAME_LAYOUT_ORIGIN
	editor.run(() => {
		for (let index = 0; index < shapes.length; index += columns) {
			const row = shapes.slice(index, index + columns)
			let columnX = originX
			for (const item of row) {
				editor.updateShape<BrowserShape>({
					id: item.id,
					type: 'dev-browser',
					x: columnX,
					y: rowY,
				})
				columnX += item.props.w + FRAME_COLUMN_GAP
			}
			rowY += Math.max(...row.map((item) => item.props.h)) + FRAME_ROW_GAP
		}
	})

	requestAnimationFrame(() => {
		if (organizingSelection) {
			editor.zoomToSelection({ animation: { duration: 240 } })
		} else {
			editor.zoomToFit({ animation: { duration: 240 } })
		}
	})
}

function scheduleBrowserShapeLayout(editor: Editor) {
	const pending = pendingLayouts.get(editor)
	if (pending) cancelAnimationFrame(pending)
	pendingLayouts.set(
		editor,
		requestAnimationFrame(() => {
			pendingLayouts.delete(editor)
			const shapes = getOrderedBrowserShapes(editor)
			if (shapes.length === 0) return

			let rowY = Math.min(...shapes.map((item) => item.y))
			for (let index = 0; index < shapes.length; index += FRAME_COLUMNS) {
				const row = shapes.slice(index, index + FRAME_COLUMNS)
				for (const item of row) {
					if (Math.abs(item.y - rowY) > 1) {
						editor.updateShape<BrowserShape>({
							id: item.id,
							type: 'dev-browser',
							y: rowY,
						})
					}
				}
				rowY += Math.max(...row.map((item) => item.props.h)) + FRAME_ROW_GAP
			}
		}),
	)
}

function getOrderedBrowserShapes(editor: Editor) {
	return orderBrowserShapes(
		editor
			.getCurrentPageShapes()
			.filter((item): item is BrowserShape => item.type === 'dev-browser'),
	)
}

function orderBrowserShapes(shapes: BrowserShape[]) {
	return [...shapes].sort((a, b) => a.y - b.y || a.x - b.x)
}
