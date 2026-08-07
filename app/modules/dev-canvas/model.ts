export const DEV_CANVAS_VERSION = 1 as const
export const DEV_CANVAS_SNAPSHOT_PATH = '/__dev-canvas/snapshots/'

export const CANVAS_ITEM_STATUSES = [
	'changes-requested',
	'in-progress',
	'archived',
	'approved',
	'ready-for-review',
] as const

export type CanvasItemStatus = (typeof CANVAS_ITEM_STATUSES)[number]

export type CanvasItemSnapshot = {
	artifactId: string
	sourceUrl: string
	capturedAt: string
}

export type CanvasItem = {
	id: string
	url: string
	title: string
	source: 'manual' | 'portless' | 'agent' | 'snapshot'
	status: CanvasItemStatus
	addedAt: string
	snapshot?: CanvasItemSnapshot
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

export type CanvasSummary = Pick<
	CanvasDocument,
	'id' | 'title' | 'updatedAt'
> & {
	itemCount: number
}

export type CanvasCommand =
	| {
			type: 'add'
			items: CanvasItemInput[]
	  }
	| { type: 'remove'; itemId: string }
	| { type: 'set-status'; itemId: string; status: CanvasItemStatus }
	| { type: 'set-item-title'; itemId: string; title: string }
	| {
			type: 'replace'
			items: CanvasItemInput[]
	  }
	| { type: 'rename'; title: string }

export type CanvasItemInput = {
	url: string
	title?: string
	source?: CanvasItem['source']
	status?: CanvasItemStatus
	snapshot?: CanvasItemSnapshot
}

export type CanvasRepository = {
	read(canvasId: string): Promise<CanvasSnapshot>
	list(): Promise<CanvasSummary[]>
	getUrlTitle(url: string): Promise<string | null>
	dispatch(canvasId: string, command: CanvasCommand): Promise<CanvasSnapshot>
	snapshot(canvasId: string, itemId: string): Promise<CanvasSnapshot>
}

export function summarizeCanvas(document: CanvasDocument): CanvasSummary {
	return {
		id: document.id,
		title: document.title,
		itemCount: document.items.length,
		updatedAt: document.updatedAt,
	}
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
				byUrl.set(
					item.url,
					existing
						? {
								...existing,
								...item,
								status: input.status ?? existing.status,
							}
						: item,
				)
			}
			return { ...document, items: [...byUrl.values()], updatedAt: now }
		}
		case 'remove':
			return {
				...document,
				items: document.items.filter((item) => item.id !== command.itemId),
				updatedAt: now,
			}
		case 'set-status':
			return {
				...document,
				items: document.items.map((item) =>
					item.id === command.itemId
						? { ...item, status: command.status }
						: item,
				),
				updatedAt: now,
			}
		case 'set-item-title': {
			const title = normalizeItemTitle(command.title)
			return {
				...document,
				items: document.items.map((item) =>
					item.id === command.itemId && title ? { ...item, title } : item,
				),
				updatedAt: now,
			}
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
	if (input.startsWith(DEV_CANVAS_SNAPSHOT_PATH)) {
		const url = new URL(input, 'http://dev-canvas.local')
		url.hash = ''
		return `${url.pathname}${url.search}`
	}
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

export function snapshotArtifactUrl(artifactId: string) {
	if (!/^[a-z0-9-]+$/.test(artifactId)) {
		throw new Error('Invalid snapshot artifact id.')
	}
	return `${DEV_CANVAS_SNAPSHOT_PATH}${artifactId}`
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

function createCanvasItem(input: CanvasItemInput, now: string): CanvasItem {
	const url = normalizeUrl(input.url)
	return {
		id: createItemId(url),
		url,
		title: normalizeItemTitle(input.title?.trim() || titleFromUrl(url)),
		source: input.source ?? 'manual',
		status: input.status ?? 'in-progress',
		addedAt: now,
		snapshot: input.snapshot,
	}
}

/** Strip a leading short id like "A – " or "12 - " from frame titles. */
export function normalizeItemTitle(title: string) {
	return title.replace(/^[A-Za-z0-9]+\s*[–—-]\s+/, '').trim() || title.trim()
}

export function normalizeItemStatus(status: unknown): CanvasItemStatus {
	return CANVAS_ITEM_STATUSES.includes(status as CanvasItemStatus)
		? (status as CanvasItemStatus)
		: 'in-progress'
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
