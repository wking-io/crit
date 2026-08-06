import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { CanvasCommand } from '../../app/modules/dev-canvas/model'
import { normalizeCanvasId } from '../../app/modules/dev-canvas/model'
import { createCanvasStorage } from './storage'

const API_PREFIX = '/__dev-canvas/api/canvases/'

export function devCanvasPlugin({ root }: { root: string }): Plugin {
	const storage = createCanvasStorage(root)

	return {
		name: 'dev-canvas-local-adapter',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const pathname = getPathname(request)
				if (!pathname.startsWith(API_PREFIX)) {
					next()
					return
				}

				const canvasId = normalizeCanvasId(
					decodeURIComponent(pathname.slice(API_PREFIX.length)),
				)
				try {
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
