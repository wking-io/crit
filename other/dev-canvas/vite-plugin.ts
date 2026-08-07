import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { CanvasCommand } from '../../app/modules/dev-canvas/model'
import {
	DEV_CANVAS_SNAPSHOT_PATH,
	normalizeCanvasId,
} from '../../app/modules/dev-canvas/model'
import { readUrlDocumentTitle } from './metadata'
import { createCanvasStorage } from './storage'

const CANVASES_PATH = '/__dev-canvas/api/canvases'
const API_PREFIX = '/__dev-canvas/api/canvases/'
const METADATA_PATH = '/__dev-canvas/api/metadata'

export function devCanvasPlugin({ root }: { root: string }): Plugin {
	const storage = createCanvasStorage(root)

	return {
		name: 'dev-canvas-local-adapter',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const pathname = getPathname(request)
				if (pathname.startsWith(DEV_CANVAS_SNAPSHOT_PATH)) {
					if (request.method !== 'GET') {
						sendJson(response, 405, { error: 'Method not allowed.' })
						return
					}
					try {
						const artifactId = decodeURIComponent(
							pathname.slice(DEV_CANVAS_SNAPSHOT_PATH.length),
						)
						sendHtml(response, await storage.readSnapshot(artifactId))
					} catch (error) {
						sendJson(response, isNodeError(error, 'ENOENT') ? 404 : 400, {
							error:
								error instanceof Error
									? error.message
									: 'Snapshot could not be loaded.',
						})
					}
					return
				}
				if (pathname === METADATA_PATH) {
					if (request.method !== 'GET') {
						sendJson(response, 405, { error: 'Method not allowed.' })
						return
					}
					const url = new URL(
						request.url || METADATA_PATH,
						'http://dev-canvas.local',
					).searchParams.get('url')
					if (!url) {
						sendJson(response, 400, { error: 'A URL is required.' })
						return
					}
					sendJson(response, 200, {
						title: await readUrlDocumentTitle(url),
					})
					return
				}
				if (pathname === CANVASES_PATH) {
					if (request.method !== 'GET') {
						sendJson(response, 405, { error: 'Method not allowed.' })
						return
					}
					sendJson(response, 200, await storage.list())
					return
				}
				if (!pathname.startsWith(API_PREFIX)) {
					next()
					return
				}

				const [rawCanvasId, action, rawItemId] = pathname
					.slice(API_PREFIX.length)
					.split('/')
				const canvasId = normalizeCanvasId(
					decodeURIComponent(rawCanvasId ?? ''),
				)
				try {
					if (action === 'snapshots' && rawItemId) {
						if (request.method !== 'POST') {
							sendJson(response, 405, { error: 'Method not allowed.' })
							return
						}
						sendJson(
							response,
							200,
							await storage.snapshot(canvasId, decodeURIComponent(rawItemId)),
						)
						return
					}
					if (request.method === 'GET') {
						sendJson(response, 200, await storage.read(canvasId))
						return
					}
					if (request.method === 'POST') {
						const command = await readJsonBody<CanvasCommand>(request)
						sendJson(response, 200, await storage.dispatch(canvasId, command))
						return
					}
					sendJson(response, 405, { error: 'Method not allowed.' })
				} catch (error) {
					sendJson(response, 400, {
						error:
							error instanceof Error ? error.message : 'Canvas request failed.',
					})
				}
			})
		},
	}
}

function getPathname(request: IncomingMessage) {
	return new URL(request.url || '/', 'http://dev-canvas.local').pathname
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = []
	let length = 0
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		length += buffer.length
		if (length > 256_000) throw new Error('Request body is too large.')
		chunks.push(buffer)
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.statusCode = status
	response.setHeader('Content-Type', 'application/json; charset=utf-8')
	response.setHeader('Cache-Control', 'no-store')
	response.end(JSON.stringify(body))
}

function sendHtml(response: ServerResponse, body: Buffer) {
	response.statusCode = 200
	response.setHeader('Content-Type', 'text/html; charset=utf-8')
	response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
	response.setHeader('X-Content-Type-Options', 'nosniff')
	response.end(body)
}

function isNodeError(error: unknown, code: string) {
	return (
		error instanceof Error &&
		'code' in error &&
		(error as NodeJS.ErrnoException).code === code
	)
}
