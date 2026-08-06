import { constants } from 'node:fs'
import {
	access,
	mkdir,
	readFile,
	readdir,
	rename,
	writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
	applyCanvasCommand,
	createCanvasDocument,
	createItemId,
	normalizeCanvasId,
} from '../../app/modules/dev-canvas/model'
import type {
	CanvasCommand,
	CanvasDocument,
	CanvasSnapshot,
	PortlessSource,
} from '../../app/modules/dev-canvas/model'

type PortlessRoute = {
	hostname: string
	port: number
	pid: number
	tailscaleUrl?: string
	ngrokUrl?: string
}

export function createCanvasStorage(root: string) {
	const canvasDirectory = path.join(root, '.dev-canvas', 'canvases')

	return {
		async read(canvasId: string): Promise<CanvasSnapshot> {
			const canvas = await readCanvas(canvasDirectory, canvasId)
			return {
				canvas,
				sources: await readPortlessSources(),
				mode: 'local-server',
			}
		},

		async dispatch(
			canvasId: string,
			command: CanvasCommand,
		): Promise<CanvasSnapshot> {
			const current = await readCanvas(canvasDirectory, canvasId)
			const canvas = applyCanvasCommand(current, command)
			await writeCanvas(canvasDirectory, canvas)
			return {
				canvas,
				sources: await readPortlessSources(),
				mode: 'local-server',
			}
		},

		async list(): Promise<CanvasDocument[]> {
			try {
				const entries = await readdir(canvasDirectory)
				const documents = await Promise.all(
					entries
						.filter((entry) => entry.endsWith('.json'))
						.map((entry) =>
							readCanvas(canvasDirectory, entry.slice(0, -'.json'.length)),
						),
				)
				return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			} catch (error) {
				if (isNodeError(error, 'ENOENT')) return []
				throw error
			}
		},

		readSources: readPortlessSources,
	}
}

async function readCanvas(directory: string, canvasId: string) {
	const id = normalizeCanvasId(canvasId)
	const filePath = path.join(directory, `${id}.json`)
	try {
		const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
		if (!isCanvasDocument(parsed) || parsed.id !== id) {
			throw new Error(`Invalid canvas document: ${filePath}`)
		}
		return parsed
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return createCanvasDocument(id)
		throw error
	}
}

async function writeCanvas(directory: string, document: CanvasDocument) {
	await mkdir(directory, { recursive: true })
	const filePath = path.join(
		directory,
		`${normalizeCanvasId(document.id)}.json`,
	)
	const temporaryPath = `${filePath}.${process.pid}.tmp`
	await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
		mode: 0o600,
	})
	await rename(temporaryPath, filePath)
}

async function readPortlessSources(): Promise<PortlessSource[]> {
	const stateDirectory =
		process.env.PORTLESS_STATE_DIR || path.join(homedir(), '.portless')
	const routesPath = path.join(stateDirectory, 'routes.json')
	try {
		const parsed: unknown = JSON.parse(await readFile(routesPath, 'utf8'))
		if (!Array.isArray(parsed)) return []
		const routes = parsed.filter(isPortlessRoute).filter(isLiveRoute)
		const proxyPort = await readNumberFile(
			path.join(stateDirectory, 'proxy.port'),
			443,
		)
		const hasTls = await fileContainsOne(path.join(stateDirectory, 'proxy.tls'))
		const protocol = hasTls ? 'https' : 'http'
		const defaultPort = hasTls ? 443 : 80
		const portSuffix = proxyPort === defaultPort ? '' : `:${proxyPort}`

		return routes
			.map((route) => {
				const url = `${protocol}://${route.hostname}${portSuffix}/`
				return {
					id: createItemId(url),
					url,
					title: route.hostname.replace(/\.localhost$/, ''),
					hostname: route.hostname,
					port: route.port,
				}
			})
			.sort((a, b) => a.hostname.localeCompare(b.hostname))
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return []
		return []
	}
}

async function readNumberFile(filePath: string, fallback: number) {
	try {
		const value = Number((await readFile(filePath, 'utf8')).trim())
		return Number.isInteger(value) && value > 0 ? value : fallback
	} catch {
		return fallback
	}
}

async function fileContainsOne(filePath: string) {
	try {
		await access(filePath, constants.R_OK)
		return (await readFile(filePath, 'utf8')).trim() === '1'
	} catch {
		return false
	}
}

function isPortlessRoute(value: unknown): value is PortlessRoute {
	if (!value || typeof value !== 'object') return false
	const route = value as Partial<PortlessRoute>
	return (
		typeof route.hostname === 'string' &&
		typeof route.port === 'number' &&
		typeof route.pid === 'number'
	)
}

function isLiveRoute(route: PortlessRoute) {
	if (route.pid === 0) return true
	try {
		process.kill(route.pid, 0)
		return true
	} catch {
		return false
	}
}

function isCanvasDocument(value: unknown): value is CanvasDocument {
	if (!value || typeof value !== 'object') return false
	const document = value as Partial<CanvasDocument>
	return (
		document.version === 1 &&
		typeof document.id === 'string' &&
		typeof document.title === 'string' &&
		Array.isArray(document.items) &&
		typeof document.updatedAt === 'string'
	)
}

function isNodeError(error: unknown, code: string) {
	return (
		error instanceof Error &&
		'code' in error &&
		(error as NodeJS.ErrnoException).code === code
	)
}
