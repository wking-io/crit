export const DEV_CANVAS_HEIGHT_MESSAGE = 'dev-canvas:document-height'

export type DevCanvasHeightMessage = {
	type: typeof DEV_CANVAS_HEIGHT_MESSAGE
	documentHeight: number
	viewportHeight: number
}

export function parseDevCanvasHeightMessage(
	value: unknown,
): DevCanvasHeightMessage | null {
	if (!value || typeof value !== 'object') return null
	const message = value as Partial<DevCanvasHeightMessage>
	if (
		message.type !== DEV_CANVAS_HEIGHT_MESSAGE ||
		typeof message.documentHeight !== 'number' ||
		!Number.isFinite(message.documentHeight) ||
		message.documentHeight <= 0 ||
		typeof message.viewportHeight !== 'number' ||
		!Number.isFinite(message.viewportHeight) ||
		message.viewportHeight <= 0
	) {
		return null
	}
	return message as DevCanvasHeightMessage
}

export function startDevCanvasHeightReporter() {
	if (window.parent === window) return () => {}

	const root = document.documentElement
	const body = document.body
	const report = () => {
		const message: DevCanvasHeightMessage = {
			type: DEV_CANVAS_HEIGHT_MESSAGE,
			documentHeight: Math.max(
				root.scrollHeight,
				root.offsetHeight,
				body.scrollHeight,
				body.offsetHeight,
			),
			viewportHeight: window.innerHeight,
		}
		window.parent.postMessage(message, '*')
	}

	const resizeObserver = new ResizeObserver(report)
	resizeObserver.observe(root)
	resizeObserver.observe(body)

	const mutationObserver = new MutationObserver(report)
	mutationObserver.observe(root, {
		attributes: true,
		childList: true,
		subtree: true,
		characterData: true,
	})

	window.addEventListener('resize', report)
	let animationFrame = requestAnimationFrame(() => {
		report()
		animationFrame = requestAnimationFrame(report)
	})
	void document.fonts?.ready.then(report)

	return () => {
		cancelAnimationFrame(animationFrame)
		window.removeEventListener('resize', report)
		resizeObserver.disconnect()
		mutationObserver.disconnect()
	}
}
