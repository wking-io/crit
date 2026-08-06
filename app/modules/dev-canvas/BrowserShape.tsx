import { Tooltip } from '@base-ui/react/tooltip'
import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
} from '@tldraw/tlschema'
import type { SpringConfig } from 'dialkit'
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
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	stopEventPropagation,
	useEditor,
} from 'tldraw'
import type { Editor, TLBaseShape } from 'tldraw'
import {
	FRAME_STATUSES,
	IconFullscreen,
	IconOpenExternal,
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
	statusAnimation: StatusAnimationSettings
}

export type StatusAnimationSettings = {
	spring: SpringConfig
	stagger: number
	curve: number
	curveExponent: number
	curveDelay: number
	originX: number
	originOffset: number
	pillScale: number
	pillGap: number
	frameGap: number
}

export const DEFAULT_STATUS_ANIMATION: StatusAnimationSettings = {
	spring: { type: 'spring', visualDuration: 0.5, bounce: 0.28 },
	stagger: 0.055,
	curve: 56,
	curveExponent: 1.7,
	curveDelay: 0.08,
	originX: 8,
	originOffset: 12,
	pillScale: 0.9,
	pillGap: 2,
	frameGap: 4,
}

const BrowserShapeActionsContext = createContext<BrowserShapeActions>({
	remove() {},
	setStatus() {},
	statusAnimation: DEFAULT_STATUS_ANIMATION,
})

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

export function projectedRectangleRadius(
	width: number,
	height: number,
	angle: number,
	axisX: number,
	axisY: number,
) {
	const localXProjection = Math.cos(angle) * axisX + Math.sin(angle) * axisY
	const localYProjection = -Math.sin(angle) * axisX + Math.cos(angle) * axisY
	return (
		(width / 2) * Math.abs(localXProjection) +
		(height / 2) * Math.abs(localYProjection)
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

export type StatusPillLayoutItem = {
	distanceFromFrame: number
	curveScale: number
	finalRotate: number
	angle: number
	width: number
	verticalHalfExtent: number
	finalX: number
	centerX: number
	centerY: number
	finalY: number
}

export function calculateStatusPillLayout(
	widths: number[],
	animation: Pick<
		StatusAnimationSettings,
		'curve' | 'curveExponent' | 'pillGap'
	>,
) {
	const layout: StatusPillLayoutItem[] = widths.map((width, index) => {
		const distanceFromFrame = widths.length - index
		const curveScale = distanceFromFrame / widths.length
		const curveSlope =
			(animation.curve *
				animation.curveExponent *
				Math.pow(curveScale, animation.curveExponent - 1)) /
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
			curveScale,
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
			animation.curve * Math.pow(bottomItem.curveScale, animation.curveExponent)
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
		const gap = Math.max(0, animation.pillGap)
		// The two support vectors reach the facing rounded edges. Adding
		// gap * normal makes their closest points exactly `gap` pixels apart.
		item.centerX =
			lowerItem.centerX + itemSupport.x + lowerItemSupport.x + normalX * gap
		item.finalX = item.centerX - item.width / 2
		item.centerY =
			lowerItem.centerY + itemSupport.y + lowerItemSupport.y + normalY * gap
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
			title: 'New iteration',
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

function BrowserShapeView({ shape }: { shape: BrowserShape }) {
	const actions = useContext(BrowserShapeActionsContext)
	const editor = useEditor()
	const frameRef = useRef<HTMLDivElement>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const statusButtonRef = useRef<HTMLButtonElement>(null)
	const statusMenuRef = useRef<HTMLDivElement>(null)
	const stopObservingHeight = useRef<null | (() => void)>(null)
	const actionTooltip = useMemo(() => Tooltip.createHandle<string>(), [])
	const [fullscreen, setFullscreen] = useState(false)
	const [statusMenuOpen, setStatusMenuOpen] = useState(false)
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
			const clickedDialKit =
				target instanceof Element && target.closest('.dialkit-root')
			if (
				clickedDialKit ||
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

	useEffect(() => {
		stopObservingHeight.current?.()
		stopObservingHeight.current = null
		setLoadState('loading')
		setAutoSized(false)
		const timeout = window.setTimeout(() => {
			setLoadState((current) => (current === 'loading' ? 'failed' : current))
		}, FRAME_LOAD_TIMEOUT)
		return () => window.clearTimeout(timeout)
	}, [shape.props.url])

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
	const animation = actions.statusAnimation
	const availableStatuses = FRAME_STATUSES.filter(
		(option) => option.id !== status.id,
	)
	const statusPillLayout = calculateStatusPillLayout(
		availableStatuses.map((option) => measureStatusPillWidth(option.label)),
		animation,
	).map((layout, index) => ({
		...layout,
		option: availableStatuses[index]!,
	}))
	const rotatedBottomHalfHeight =
		statusPillLayout.at(-1)?.verticalHalfExtent ?? STATUS_PILL_HEIGHT / 2
	const statusFrameGap =
		animation.frameGap +
		Math.max(0, rotatedBottomHalfHeight - STATUS_PILL_HEIGHT / 2)

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
					pointerEvents: statusMenuOpen ? 'all' : 'none',
				}}
			>
				<AnimatePresence>
					{statusMenuOpen
						? statusPillLayout.map(
								({
									option,
									distanceFromFrame,
									curveScale,
									finalX,
									finalY,
									finalRotate,
								}) => {
									const OptionIcon = option.icon
									const startY =
										distanceFromFrame * STATUS_PILL_STEP +
										animation.originOffset
									const delay = (distanceFromFrame - 1) * animation.stagger
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
												scale: animation.pillScale,
												x: animation.originX,
												y: startY,
												rotate: 0,
											}}
											animate={{
												opacity: 1,
												scale: 1,
												x: finalX,
												y: finalY,
												rotate: finalRotate,
											}}
											exit={{
												opacity: 0,
												scale: animation.pillScale,
												x: animation.originX,
												y: startY,
												rotate: 0,
											}}
											transition={{
												x: {
													...animation.spring,
													delay: delay + animation.curveDelay * curveScale,
												},
												y: { ...animation.spring, delay },
												rotate: { ...animation.spring, delay },
												scale: { ...animation.spring, delay },
												opacity: { duration: 0.12, delay },
											}}
											onClick={() => {
												actions.setStatus(shape.props.itemId, option.id)
												setStatusMenuOpen(false)
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
							onPointerDown={stopEventPropagation}
							onClick={() => setStatusMenuOpen((open) => !open)}
						>
							<StatusIcon />
						</button>
						<span className="dev-browser__title-mask" title={chromeTitle}>
							<span className="dev-browser__title-track">
								<strong>{chromeTitle}</strong>
								<strong>{status.label}</strong>
							</span>
						</span>
					</div>
					<div
						className="dev-browser__actions"
						onPointerDown={stopEventPropagation}
					>
						<Tooltip.Provider delay={450} closeDelay={80}>
							<Tooltip.Trigger
								handle={actionTooltip}
								payload="Open in a new tab"
								aria-label="Open in a new tab"
								render={
									<a href={shape.props.url} target="_blank" rel="noreferrer" />
								}
							>
								<IconOpenExternal />
							</Tooltip.Trigger>
							<Tooltip.Trigger
								handle={actionTooltip}
								payload={fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'}
								aria-label={
									fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'
								}
								type="button"
								onClick={() => void toggleFullscreen()}
							>
								<IconFullscreen />
							</Tooltip.Trigger>
							<Tooltip.Trigger
								handle={actionTooltip}
								payload="Remove from canvas"
								aria-label="Remove from canvas"
								type="button"
								onClick={() => actions.remove(shape.props.itemId)}
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
					{loadState === 'loading' ? (
						<div className="dev-browser__loading">
							<span />
							Loading {shape.props.title}
						</div>
					) : null}
					{loadState === 'failed' ? (
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
					<iframe
						ref={iframeRef}
						src={shape.props.url}
						title={shape.props.title}
						onLoad={handleLoad}
						onError={() => setLoadState('failed')}
						scrolling={autoSized ? 'no' : 'auto'}
						allow="clipboard-read; clipboard-write; fullscreen"
						referrerPolicy="no-referrer"
					/>
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
