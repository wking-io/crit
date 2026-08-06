import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	matchesPortlessIteration,
	normalizeCanvasId,
} from '../../app/modules/dev-canvas/model'
import type {
	CanvasCommand,
	PortlessSource,
} from '../../app/modules/dev-canvas/model'
import { createCanvasStorage } from './storage'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const storage = createCanvasStorage(root)

await main(process.argv.slice(2))

async function main(args: string[]) {
	const [command = 'help', canvasName, ...rest] = args

	switch (command) {
		case 'add': {
			if (!canvasName || rest.length === 0) return printHelp(1)
			await update(canvasName, {
				type: 'add',
				items: rest.map((url) => ({ url, source: 'agent' })),
			})
			return
		}
		case 'remove': {
			if (!canvasName || rest.length !== 1) return printHelp(1)
			await update(canvasName, { type: 'remove', itemId: rest[0] })
			return
		}
		case 'open': {
			if (!canvasName) return printHelp(1)
			const options = parseOpenOptions(rest)
			let snapshot = await storage.read(canvasName)
			const matchingSources = selectSources(snapshot.sources, options)
			if (matchingSources.length > 0) {
				snapshot = await storage.dispatch(canvasName, {
					type: 'add',
					items: matchingSources.map((source) => ({
						url: source.url,
						title: source.title,
						source: 'portless',
					})),
				})
			}
			const canvasUrl = await getCanvasUrl(snapshot.sources, snapshot.canvas.id)
			console.log(
				`Canvas "${snapshot.canvas.title}" has ${snapshot.canvas.items.length} iteration(s).`,
			)
			console.log(canvasUrl)
			if (!options.noBrowser) openBrowser(canvasUrl)
			return
		}
		case 'list': {
			const canvases = await storage.list()
			if (canvases.length === 0) {
				console.log('No local canvases yet.')
				return
			}
			for (const canvas of canvases) {
				console.log(
					`${canvas.id.padEnd(24)} ${String(canvas.items.length).padStart(3)} iteration(s)`,
				)
			}
			return
		}
		case 'sources': {
			const sources = await storage.readSources()
			if (sources.length === 0) {
				console.log('No active Portless routes.')
				return
			}
			for (const source of sources) console.log(source.url)
			return
		}
		case 'help':
		case '--help':
		case '-h':
			printHelp(0)
			return
		default:
			printHelp(1)
	}
}

async function update(canvasName: string, command: CanvasCommand) {
	const snapshot = await storage.dispatch(canvasName, command)
	console.log(
		`Updated "${snapshot.canvas.title}" (${snapshot.canvas.items.length} iteration(s)).`,
	)
}

function parseOpenOptions(args: string[]) {
	let iterations: string | undefined
	let match: string | undefined
	let noBrowser = false
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]
		if (argument === '--iterations') {
			iterations = args[index + 1]
			index += 1
		} else if (argument === '--match') {
			match = args[index + 1]?.toLowerCase()
			index += 1
		} else if (argument === '--no-browser') {
			noBrowser = true
		} else {
			throw new Error(`Unknown option: ${argument}`)
		}
	}
	return { iterations, match, noBrowser }
}

function selectSources(
	sources: PortlessSource[],
	options: ReturnType<typeof parseOpenOptions>,
) {
	return sources.filter((source) => {
		if (
			options.iterations &&
			!matchesPortlessIteration(source, options.iterations)
		) {
			return false
		}
		if (
			options.match &&
			!`${source.hostname} ${source.title} ${source.url}`
				.toLowerCase()
				.includes(options.match)
		) {
			return false
		}
		return Boolean(options.iterations || options.match)
	})
}

async function getCanvasUrl(sources: PortlessSource[], canvasId: string) {
	const configured = process.env.DEV_CANVAS_URL
	if (configured) {
		return new URL(
			`/canvas/${normalizeCanvasId(canvasId)}`,
			configured,
		).toString()
	}

	const packageJson = JSON.parse(
		await readFile(path.join(root, 'package.json'), 'utf8'),
	) as { portless?: { name?: string } }
	const appName = packageJson.portless?.name
	const ownRoute = appName
		? sources.find(
				(source) =>
					source.hostname === `${appName}.localhost` ||
					source.hostname.endsWith(`.${appName}.localhost`),
			)
		: undefined
	const origin = ownRoute?.url || `https://${appName || 'wking'}.localhost`
	if (!ownRoute) {
		console.warn(
			'Canvas host is not running. Start it with: npm run dev:portless',
		)
	}
	return new URL(`/canvas/${normalizeCanvasId(canvasId)}`, origin).toString()
}

function openBrowser(url: string) {
	let opener: string
	let openerArguments: string[]
	if (process.platform === 'darwin') {
		opener = 'open'
		openerArguments = [url]
	} else if (process.platform === 'win32') {
		opener = 'cmd'
		openerArguments = ['/c', 'start', '', url]
	} else {
		opener = 'xdg-open'
		openerArguments = [url]
	}
	const child = spawn(opener, openerArguments, {
		detached: true,
		stdio: 'ignore',
	})
	child.unref()
}

function printHelp(exitCode: number) {
	console.log(`Developer canvas

  npm run canvas -- open <canvas> --iterations <app>
  npm run canvas -- open <canvas> --match <text>
  npm run canvas -- add <canvas> <url...>
  npm run canvas -- remove <canvas> <item-id>
  npm run canvas -- list
  npm run canvas -- sources

Examples:
  npm run canvas -- open checkout-review --iterations storefront
  npm run canvas -- add checkout-review https://fix-copy.storefront.localhost
`)
	process.exitCode = exitCode
}
