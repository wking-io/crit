import {
	createContext,
	useCallback,
	useContext,
	useEffect,
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
import { parseDevCanvasHeightMessage } from './frame-height-bridge.client'

export type BrowserShape = TLBaseShape<
	'dev-browser',
	{
		w: number
		h: number
		itemId: string
		url: string
		title: string
		source: string
	}
>

type BrowserShapeActions = {
	remove(itemId: string): void
}

const BrowserShapeActionsContext = createContext<BrowserShapeActions>({
	remove() {},
})

const FRAME_VERTICAL_CHROME = 54
const FRAME_ROW_GAP = 80
const FRAME_COLUMN_GAP = 80
const FRAME_COLUMNS = 2
const FRAME_INITIAL_HEIGHT = 580
const FRAME_LOAD_TIMEOUT = 12_000
const FRAME_LAYOUT_ORIGIN = 120

export const BrowserShapeActionsProvider = BrowserShapeActionsContext.Provider

export class BrowserShapeUtil extends BaseBoxShapeUtil<BrowserShape> {
	static override type = 'dev-browser' as const

	static override props = {
		w: T.number,
		h: T.number,
		itemId: T.string,
		url: T.string,
		title: T.string,
		source: T.string,
	}

	override getDefaultProps(): BrowserShape['props'] {
		return {
			w: 880,
			h: 580,
			itemId: '',
			url: 'about:blank',
			title: 'New iteration',
			source: 'manual',
		}
	}

	override canResize() {
		return true
	}

	override component(shape: BrowserShape) {
		return <BrowserShapeView shape={shape} />
	}

	override indicator(shape: BrowserShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
	}
}

function BrowserShapeView({ shape }: { shape: BrowserShape }) {
	const actions = useContext(BrowserShapeActionsContext)
	const editor = useEditor()
	const frameRef = useRef<HTMLDivElement>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const stopObservingHeight = useRef<null | (() => void)>(null)
	const [fullscreen, setFullscreen] = useState(false)
	const [loadState, setLoadState] = useState<
		'loading' | 'loaded' | 'failed'
	>('loading')
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
		stopObservingHeight.current?.()
		stopObservingHeight.current = null
		setLoadState('loading')
		setAutoSized(false)
		const timeout = window.setTimeout(() => {
			setLoadState((current) =>
				current === 'loading' ? 'failed' : current,
			)
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
				ref={frameRef}
				className="dev-browser"
				style={{ width: shape.props.w, height: shape.props.h }}
			>
				<div className="dev-browser__chrome">
					<div className="dev-browser__traffic" aria-hidden="true">
						<span />
						<span />
						<span />
					</div>
					<div className="dev-browser__identity">
						<strong>{shape.props.title}</strong>
						<span>{shape.props.url}</span>
					</div>
					<div
						className="dev-browser__actions"
						onPointerDown={stopEventPropagation}
					>
						<a
							href={shape.props.url}
							target="_blank"
							rel="noreferrer"
							title="Open in a new tab"
							aria-label={`Open ${shape.props.title} in a new tab`}
						>
							↗
						</a>
						<button
							type="button"
							onClick={() => void toggleFullscreen()}
							title={fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'}
							aria-label={
								fullscreen ? 'Collapse to canvas' : 'Enter fullscreen'
							}
						>
							{fullscreen ? '↙' : '⛶'}
						</button>
						<button
							type="button"
							onClick={() => actions.remove(shape.props.itemId)}
							title="Remove from canvas"
							aria-label={`Remove ${shape.props.title} from canvas`}
						>
							×
						</button>
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
							<a
								href={shape.props.url}
								target="_blank"
								rel="noreferrer"
							>
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
		organizingSelection &&
		selectionWidth < widestShape + FRAME_COLUMN_GAP / 2
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
