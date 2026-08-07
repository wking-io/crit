import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'node-html-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotArchive } from './snapshot-archive'

const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					),
			),
	)
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

describe('URL snapshot archive', () => {
	it('stores one self-contained minified HTML artifact', async () => {
		const origin = await startFixtureServer()
		const root = await makeTemporaryDirectory()
		const archive = createSnapshotArchive(root, {
			createId: () => '20260806210000-deadbeef',
			now: () => new Date('2026-08-06T21:00:00.000Z'),
		})

		const artifact = await archive.capture(`${origin}/`)
		const html = (await archive.read(artifact.id)).toString('utf8')

		expect(artifact).toMatchObject({
			id: '20260806210000-deadbeef',
			sourceUrl: `${origin}/`,
			capturedAt: '2026-08-06T21:00:00.000Z',
		})
		expect(artifact.sizeBytes).toBe(Buffer.byteLength(html))
		expect(html).toContain('<!doctype html>')
		expect(html).toContain('data:image/svg+xml')
		const moduleSource = parse(html)
			.querySelector('script[type="module"]')
			?.getAttribute('src')
			?.split('base64,')[1]
		expect(
			Buffer.from(moduleSource ?? '', 'base64').toString('utf8'),
		).toContain('frozen')
		expect(html).not.toContain('src="/app.js"')
		expect(html).not.toContain('href="/styles.css"')
		expect(html).not.toContain('/* source comment */')
		expect(html).not.toContain('import ')
	})
})

async function startFixtureServer() {
	const server = createServer((request, response) => {
		switch (request.url) {
			case '/':
				response.setHeader('Content-Type', 'text/html')
				response.end(`<!doctype html>
					<html>
						<head>
							<link rel="stylesheet" href="/styles.css">
							<style>.inline { padding: 0  4px; }</style>
						</head>
						<body>
							<h1>Frozen page</h1>
							<img src="/pixel.svg" alt="">
							<script>window.fixture = true;</script>
							<script type="module" src="/app.js"></script>
						</body>
					</html>`)
				return
			case '/styles.css':
				response.setHeader('Content-Type', 'text/css')
				response.end(
					'/* source comment */ body { color: red; background: url("/pixel.svg"); }',
				)
				return
			case '/app.js':
				response.setHeader('Content-Type', 'text/javascript')
				response.end(
					'import { message } from "./dep.js"; document.documentElement.dataset.message = message;',
				)
				return
			case '/dep.js':
				response.setHeader('Content-Type', 'text/javascript')
				response.end('export const message = "frozen";')
				return
			case '/pixel.svg':
				response.setHeader('Content-Type', 'image/svg+xml')
				response.end(
					'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="red" d="M0 0h1v1H0z"/></svg>',
				)
				return
			default:
				response.statusCode = 404
				response.end('not found')
		}
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	servers.push(server)
	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not bind to a TCP port')
	}
	return `http://127.0.0.1:${address.port}`
}

async function makeTemporaryDirectory() {
	const directory = await mkdtemp(path.join(tmpdir(), 'dev-canvas-snapshot-'))
	temporaryDirectories.push(directory)
	return directory
}
