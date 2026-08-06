export const DEV_CANVAS_VERSION = 1 as const

export type CanvasItem = {
	id: string
	url: string
	title: string
	source: 'manual' | 'portless' | 'agent'
	addedAt: string
}

export type PortlessSource = {
	id: string
	url: string
	title: string
	hostname: string
	port: number
}

export type CanvasDocument = {
	version: typeof DEV_CANVAS_VERSION
	id: string
	title: string
	items: CanvasItem[]
	updatedAt: string
}

export type CanvasSnapshot = {
	canvas: CanvasDocument
	sources: PortlessSource[]
	mode: 'local-server' | 'browser'
}

export type CanvasCommand =
	| {
			type: 'add'
			items: Array<{
				url: string
				title?: string
				source?: CanvasItem['source']
			}>
	  }
	| { type: 'remove'; itemId: string }
	| {
			type: 'replace'
			items: Array<{
				url: string
				title?: string
				source?: CanvasItem['source']
			}>
	  }
	| { type: 'rename'; title: string }

export type CanvasRepository = {
	read(canvasId: string): Promise<CanvasSnapshot>
	dispatch(canvasId: string, command: CanvasCommand): Promise<CanvasSnapshot>
}

export function createCanvasDocument(
	canvasId: string,
	now = new Date().toISOString(),
): CanvasDocument {
	const id = normalizeCanvasId(canvasId)
	return {
		version: DEV_CANVAS_VERSION,
		id,
		title: titleFromId(id),
		items: [],
		updatedAt: now,
	}
}

export function applyCanvasCommand(
	document: CanvasDocument,
	command: CanvasCommand,
	now = new Date().toISOString(),
): CanvasDocument {
	switch (command.type) {
		case 'add': {
			const byUrl = new Map(document.items.map((item) => [item.url, item]))
			for (const input of command.items) {
				const item = createCanvasItem(input, now)
				const existing = byUrl.get(item.url)
				byUrl.set(item.url, existing ? { ...existing, ...item } : item)
			}
			return { ...document, items: [...byUrl.values()], updatedAt: now }
		}
		case 'remove':
			return {
				...document,
				items: document.items.filter((item) => item.id !== command.itemId),
				updatedAt: now,
			}
		case 'replace':
			return {
				...document,
				items: command.items.map((item) => createCanvasItem(item, now)),
				updatedAt: now,
			}
		case 'rename':
			return {
				...document,
				title: command.title.trim() || document.title,
				updatedAt: now,
			}
	}
}

export function normalizeCanvasId(value: string) {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return normalized || 'default'
}

export function normalizeUrl(value: string) {
	const input = value.trim()
	if (!input) throw new Error('Enter a URL.')
	const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
		? input
		: `https://${input}`
	const url = new URL(withProtocol)
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS URLs can be added.')
	}
	url.hash = ''
	return url.toString()
}

export function createItemId(url: string) {
	let hash = 2166136261
	for (const character of url) {
		hash ^= character.charCodeAt(0)
		hash = Math.imul(hash, 16777619)
	}
	return `url-${(hash >>> 0).toString(36)}`
}

export function matchesPortlessIteration(
	source: Pick<PortlessSource, 'hostname'>,
	appName: string,
) {
	const name = appName
		.trim()
		.toLowerCase()
		.replace(/\.localhost$/, '')
	const hostname = source.hostname.toLowerCase()
	return (
		hostname === `${name}.localhost` || hostname.endsWith(`.${name}.localhost`)
	)
}

function createCanvasItem(
	input: {
		url: string
		title?: string
		source?: CanvasItem['source']
	},
	now: string,
): CanvasItem {
	const url = normalizeUrl(input.url)
	return {
		id: createItemId(url),
		url,
		title: input.title?.trim() || titleFromUrl(url),
		source: input.source ?? 'manual',
		addedAt: now,
	}
}

function titleFromId(id: string) {
	return id
		.split('-')
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(' ')
}

function titleFromUrl(value: string) {
	const url = new URL(value)
	const pathname = url.pathname === '/' ? '' : url.pathname
	return `${url.hostname}${pathname}`
}
