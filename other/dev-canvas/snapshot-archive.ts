import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build, transform } from 'esbuild'
import type { Loader, Plugin } from 'esbuild'
import { NodeType, parse } from 'node-html-parser'
import type { Node as HtmlNode } from 'node-html-parser'

const SNAPSHOT_DIRECTORY = '.dev-canvas/snapshots'
const MAX_RESOURCE_BYTES = 12 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 30 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000

export type SnapshotArtifact = {
	id: string
	sourceUrl: string
	capturedAt: string
	sizeBytes: number
}

type SnapshotArchiveOptions = {
	fetch?: typeof globalThis.fetch
	now?: () => Date
	createId?: () => string
}

export function createSnapshotArchive(
	root: string,
	options: SnapshotArchiveOptions = {},
) {
	const directory = path.join(root, SNAPSHOT_DIRECTORY)
	const fetchResource = createResourceFetcher(options.fetch ?? globalThis.fetch)
	const now = options.now ?? (() => new Date())
	const createId = options.createId ?? createSnapshotId

	return {
		async capture(value: string): Promise<SnapshotArtifact> {
			const sourceUrl = normalizeSnapshotSourceUrl(value)
			const id = createId()
			assertArtifactId(id)
			const response = await fetchResource(sourceUrl)
			const html = await buildSnapshotHtml(
				response.body.toString('utf8'),
				response.url,
				`/__dev-canvas/snapshots/${id}`,
				fetchResource,
			)
			const sizeBytes = Buffer.byteLength(html)
			if (sizeBytes > MAX_SNAPSHOT_BYTES) {
				throw new Error(
					`Snapshot is too large (${formatBytes(sizeBytes)}; limit ${formatBytes(
						MAX_SNAPSHOT_BYTES,
					)}).`,
				)
			}

			await mkdir(directory, { recursive: true })
			const filePath = snapshotFilePath(directory, id)
			const temporaryPath = `${filePath}.${process.pid}.tmp`
			await writeFile(temporaryPath, html, { mode: 0o600 })
			await rename(temporaryPath, filePath)

			return {
				id,
				sourceUrl,
				capturedAt: now().toISOString(),
				sizeBytes,
			}
		},

		async read(artifactId: string) {
			assertArtifactId(artifactId)
			return readFile(snapshotFilePath(directory, artifactId))
		},
	}
}

type FetchedResource = {
	body: Buffer
	contentType: string
	url: string
}

type FetchResource = (url: string) => Promise<FetchedResource>

function createResourceFetcher(
	fetchImpl: typeof globalThis.fetch,
): FetchResource {
	return async (url) => {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				return await fetchResourceOnce(fetchImpl, url)
			} catch (error) {
				if (!(error instanceof TypeError) || attempt > 0) throw error
				await new Promise((resolve) => setTimeout(resolve, 250))
			}
		}
		throw new Error(`Could not snapshot ${url}.`)
	}
}

async function fetchResourceOnce(
	fetchImpl: typeof globalThis.fetch,
	url: string,
): Promise<FetchedResource> {
	const response = await fetchImpl(url, {
		headers: {
			Accept: '*/*',
			'User-Agent': 'dev-canvas-snapshot/1.0',
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!response.ok) {
		throw new Error(`Could not snapshot ${url} (${response.status}).`)
	}
	const declaredLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_BYTES) {
		throw new Error(
			`Snapshot resource is too large: ${url} (${formatBytes(
				declaredLength,
			)}).`,
		)
	}
	const body = Buffer.from(await response.arrayBuffer())
	if (body.byteLength > MAX_RESOURCE_BYTES) {
		throw new Error(
			`Snapshot resource is too large: ${url} (${formatBytes(
				body.byteLength,
			)}).`,
		)
	}
	return {
		body,
		contentType: response.headers.get('content-type') ?? '',
		url: response.url || url,
	}
}

async function buildSnapshotHtml(
	source: string,
	sourceUrl: string,
	archivePath: string,
	fetchResource: FetchResource,
) {
	const documentUrl = new URL(sourceUrl)
	const root = parse(source, {
		comment: true,
		blockTextElements: {
			pre: true,
			script: true,
			style: true,
			textarea: true,
		},
	})
	const head = root.querySelector('head')
	const body = root.querySelector('body')
	if (!head || !body) {
		throw new Error('Snapshot source must contain a head and body.')
	}

	for (const meta of root.querySelectorAll('meta')) {
		if (
			meta.getAttribute('http-equiv')?.toLowerCase() ===
			'content-security-policy'
		) {
			meta.setAttribute('content', '')
		}
	}

	for (const link of [...root.querySelectorAll('link')]) {
		const rel = link
			.getAttribute('rel')
			?.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
		if (rel?.includes('stylesheet')) {
			const href = link.getAttribute('href')
			if (!href) {
				link.remove()
				continue
			}
			const stylesheetUrl = resolveDocumentUrl(href, documentUrl)
			const css = await bundleRemoteEntry(
				stylesheetUrl,
				'css',
				documentUrl,
				fetchResource,
			)
			link.setAttribute(
				'href',
				bufferToDataUrl(Buffer.from(css), 'text/css;charset=utf-8'),
			)
			link.setAttribute('data-snapshot-source-href', stylesheetUrl)
			link.removeAttribute('integrity')
			link.removeAttribute('crossorigin')
			continue
		}
		if (rel?.includes('modulepreload') || rel?.includes('preload')) {
			const href = link.getAttribute('href')
			if (href) {
				link.setAttribute(
					'data-snapshot-source-href',
					resolveDocumentUrl(href, documentUrl),
				)
			}
			link.setAttribute(
				'href',
				bufferToDataUrl(Buffer.from('export{}'), 'text/javascript'),
			)
			link.removeAttribute('integrity')
			link.removeAttribute('crossorigin')
			continue
		}
		if (
			rel?.some((value) => value === 'icon' || value === 'apple-touch-icon')
		) {
			await inlineAttributeAsset(link, 'href', documentUrl, fetchResource)
		}
	}

	for (const style of root.querySelectorAll('style')) {
		const css = await bundleInlineSource(
			style.innerHTML,
			'css',
			documentUrl,
			fetchResource,
		)
		style.set_content(escapeStyle(css))
	}

	const moduleScripts = [...root.querySelectorAll('script')].filter(
		(script) => script.getAttribute('type')?.toLowerCase() === 'module',
	)
	for (const [index, script] of moduleScripts.entries()) {
		if (script.getAttribute('type')?.toLowerCase() !== 'module') continue
		const src = script.getAttribute('src')
		const sourceCode = src
			? `import ${JSON.stringify(resolveDocumentUrl(src, documentUrl))};`
			: script.innerHTML
		let bundledJavaScript = sourceCode.trim()
			? await bundleInlineSource(sourceCode, 'js', documentUrl, fetchResource)
			: ''
		if (index === 0) {
			bundledJavaScript = `${createLocationPrelude(
				documentUrl,
				archivePath,
			)};${bundledJavaScript};${createLocationRestore(archivePath)}`
		}
		script.setAttribute(
			'src',
			bufferToDataUrl(
				Buffer.from(bundledJavaScript),
				'text/javascript;charset=utf-8',
			),
		)
		script.removeAttribute('integrity')
		script.removeAttribute('crossorigin')
		script.set_content('')
	}

	for (const script of [...root.querySelectorAll('script')]) {
		const type = script.getAttribute('type')?.toLowerCase()
		if (type === 'importmap') {
			script.remove()
			continue
		}
		if (type === 'application/ld+json') {
			try {
				script.set_content(JSON.stringify(JSON.parse(script.innerHTML)))
			} catch {
				// Preserve invalid structured data exactly as the source served it.
			}
			continue
		}
		if (
			type &&
			type !== 'text/javascript' &&
			type !== 'application/javascript'
		) {
			continue
		}
		const src = script.getAttribute('src')
		const sourceCode = src
			? (
					await fetchResource(resolveDocumentUrl(src, documentUrl))
				).body.toString('utf8')
			: script.innerHTML
		const minified = await minifyJavaScript(sourceCode)
		script.removeAttribute('integrity')
		script.removeAttribute('crossorigin')
		if (src) {
			script.setAttribute(
				'data-snapshot-source-src',
				resolveDocumentUrl(src, documentUrl),
			)
			script.setAttribute(
				'src',
				bufferToDataUrl(Buffer.from(minified), 'text/javascript;charset=utf-8'),
			)
			script.set_content('')
		} else {
			script.set_content(escapeScript(minified))
		}
	}

	await inlineDocumentAssets(root, documentUrl, fetchResource)
	removeNonRuntimeComments(root)
	const serialized = root.toString().trim()
	return /^<!doctype/i.test(serialized)
		? serialized
		: `<!doctype html>${serialized}`
}

async function bundleRemoteEntry(
	entryUrl: string,
	loader: 'css' | 'js',
	documentUrl: URL,
	fetchResource: FetchResource,
) {
	const result = await build({
		entryPoints: [entryUrl],
		bundle: true,
		format: loader === 'js' ? 'iife' : undefined,
		legalComments: 'none',
		logLevel: 'silent',
		minify: true,
		platform: 'browser',
		target: ['es2020'],
		write: false,
		plugins: [createHttpBundlePlugin(documentUrl, fetchResource)],
	})
	return readBuildOutput(result.outputFiles, loader)
}

async function bundleInlineSource(
	source: string,
	loader: 'css' | 'js',
	documentUrl: URL,
	fetchResource: FetchResource,
) {
	const result = await build({
		stdin: {
			contents: source,
			loader,
			sourcefile: `snapshot-inline.${loader}`,
		},
		bundle: true,
		format: loader === 'js' ? 'iife' : undefined,
		legalComments: 'none',
		logLevel: 'silent',
		minify: true,
		platform: 'browser',
		target: ['es2020'],
		write: false,
		plugins: [createHttpBundlePlugin(documentUrl, fetchResource)],
	})
	return readBuildOutput(result.outputFiles, loader)
}

function createHttpBundlePlugin(
	documentUrl: URL,
	fetchResource: FetchResource,
): Plugin {
	return {
		name: 'dev-canvas-http-snapshot',
		setup(build) {
			build.onResolve({ filter: /.*/ }, (args) => {
				if (/^(?:data|blob):/.test(args.path)) {
					return { path: args.path, external: true }
				}
				if (/^(?:node:|#)/.test(args.path)) {
					return { path: args.path, external: true }
				}
				const importer =
					args.namespace === 'snapshot-http' && args.importer
						? args.importer
						: documentUrl.href
				let url: URL
				try {
					url = new URL(args.path, importer)
				} catch {
					return { path: args.path, external: true }
				}
				if (url.pathname.endsWith('/@vite/client')) {
					return { path: url.href, namespace: 'vite-client-stub' }
				}
				if (url.pathname.includes('inject-hmr-runtime')) {
					return {
						path: url.href,
						namespace: 'react-refresh-preamble-stub',
					}
				}
				if (
					url.pathname.includes('@react-refresh') ||
					url.pathname.includes('hmr-runtime')
				) {
					return { path: url.href, namespace: 'react-refresh-stub' }
				}
				return { path: url.href, namespace: 'snapshot-http' }
			})

			build.onLoad({ filter: /.*/, namespace: 'vite-client-stub' }, () => ({
				contents: VITE_CLIENT_STUB,
				loader: 'js',
			}))
			build.onLoad(
				{ filter: /.*/, namespace: 'react-refresh-preamble-stub' },
				() => ({
					contents: REACT_REFRESH_PREAMBLE_STUB,
					loader: 'js',
				}),
			)
			build.onLoad({ filter: /.*/, namespace: 'react-refresh-stub' }, () => ({
				contents: REACT_REFRESH_STUB,
				loader: 'js',
			}))
			build.onLoad(
				{ filter: /.*/, namespace: 'snapshot-http' },
				async (args) => {
					const resource = await fetchResource(args.path)
					return {
						contents: resource.body,
						loader: loaderForResource(resource),
					}
				},
			)
		},
	}
}

const VITE_CLIENT_STUB = `
const hotContext={
	data:{},
	accept(){},
	acceptExports(){},
	dispose(){},
	prune(){},
	invalidate(){},
	on(){},
	off(){},
	send(){}
}
export function createHotContext(){return hotContext}
export function injectQuery(url){return url}
export function updateStyle(id,css){
	let style=document.querySelector('style[data-vite-dev-id="'+id+'"]')
	if(!style){style=document.createElement('style');style.setAttribute('data-vite-dev-id',id);document.head.appendChild(style)}
	style.textContent=css
}
export function removeStyle(id){document.querySelector('style[data-vite-dev-id="'+id+'"]')?.remove()}
export class ErrorOverlay{}
`

const REACT_REFRESH_PREAMBLE_STUB = `
window.$RefreshReg$=()=>{}
window.$RefreshSig$=()=>value=>value
window.__vite_plugin_react_preamble_installed__=true
`

const REACT_REFRESH_STUB = `
const runtime={
	injectIntoGlobalHook(){},
	register(){},
	createSignatureFunctionForTransform(){return value=>value},
	performReactRefresh(){},
	__hmr_import(){return Promise.resolve({})},
	registerExportsForReactRefresh(){},
	validateRefreshBoundaryAndEnqueueUpdate(){}
}
export default runtime
export function registerExportsForReactRefresh(){}
export function validateRefreshBoundaryAndEnqueueUpdate(){}
`

function loaderForResource(resource: FetchedResource): Loader {
	const contentType = resource.contentType.toLowerCase()
	const pathname = new URL(resource.url).pathname.toLowerCase()
	if (contentType.includes('text/css')) return 'css'
	if (
		contentType.includes('javascript') ||
		contentType.includes('ecmascript') ||
		/\.[cm]?js$/.test(pathname)
	) {
		return 'js'
	}
	if (contentType.includes('json') || pathname.endsWith('.json')) return 'json'
	if (contentType.startsWith('text/')) return 'text'
	return 'dataurl'
}

function readBuildOutput(
	outputFiles: Array<{ path: string; text: string }>,
	loader: 'css' | 'js',
) {
	const extension = loader === 'css' ? '.css' : '.js'
	const output =
		outputFiles.find((file) => file.path.endsWith(extension)) ?? outputFiles[0]
	if (!output)
		throw new Error(`Snapshot ${loader.toUpperCase()} bundle is empty.`)
	return output.text
}

async function minifyJavaScript(source: string) {
	if (!source.trim()) return ''
	const result = await transform(source, {
		legalComments: 'none',
		loader: 'js',
		minify: true,
		target: 'es2020',
	})
	return result.code
}

async function inlineDocumentAssets(
	root: ReturnType<typeof parse>,
	documentUrl: URL,
	fetchResource: FetchResource,
) {
	const attributes = [
		['img', 'src'],
		['source', 'src'],
		['video', 'src'],
		['video', 'poster'],
		['audio', 'src'],
		['input', 'src'],
	] as const
	for (const [selector, attribute] of attributes) {
		for (const element of root.querySelectorAll(selector)) {
			await inlineAttributeAsset(element, attribute, documentUrl, fetchResource)
		}
	}
	for (const element of root.querySelectorAll('img,source')) {
		const srcset = element.getAttribute('srcset')
		if (!srcset) continue
		element.setAttribute('data-snapshot-source-srcset', srcset)
		const candidates = await Promise.all(
			srcset.split(',').map(async (candidate) => {
				const [url, descriptor] = candidate.trim().split(/\s+/, 2)
				if (!url || shouldLeaveAssetUrl(url)) return candidate.trim()
				const dataUrl = await resourceToDataUrl(
					resolveDocumentUrl(url, documentUrl),
					fetchResource,
				)
				return descriptor ? `${dataUrl} ${descriptor}` : dataUrl
			}),
		)
		element.setAttribute('srcset', candidates.join(','))
	}
}

async function inlineAttributeAsset(
	element: ReturnType<typeof parse>,
	attribute: string,
	documentUrl: URL,
	fetchResource: FetchResource,
) {
	const value = element.getAttribute(attribute)
	if (!value || shouldLeaveAssetUrl(value)) return
	element.setAttribute(
		`data-snapshot-source-${attribute}`,
		resolveDocumentUrl(value, documentUrl),
	)
	element.setAttribute(
		attribute,
		await resourceToDataUrl(
			resolveDocumentUrl(value, documentUrl),
			fetchResource,
		),
	)
}

async function resourceToDataUrl(url: string, fetchResource: FetchResource) {
	const resource = await fetchResource(url)
	const mimeType =
		resource.contentType.split(';')[0]?.trim() || 'application/octet-stream'
	return bufferToDataUrl(resource.body, mimeType)
}

function bufferToDataUrl(value: Buffer, mimeType: string) {
	return `data:${mimeType};base64,${value.toString('base64')}`
}

function shouldLeaveAssetUrl(value: string) {
	return /^(?:data|blob|javascript|#):?/i.test(value)
}

function removeNonRuntimeComments(node: HtmlNode) {
	for (const child of [...node.childNodes]) {
		if (child.nodeType === NodeType.COMMENT_NODE) {
			if (!/^\s*(?:\$[?!]?|\/\$)\s*$/.test(child.rawText)) child.remove()
			continue
		}
		removeNonRuntimeComments(child)
	}
}

function resolveDocumentUrl(value: string, documentUrl: URL) {
	return new URL(value, documentUrl).href
}

function normalizeSnapshotSourceUrl(value: string) {
	const url = new URL(value)
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS URLs can be snapshotted.')
	}
	url.hash = ''
	return url.href
}

function createSnapshotId() {
	const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
	return `${timestamp}-${randomUUID().slice(0, 8)}`
}

function snapshotFilePath(directory: string, artifactId: string) {
	return path.join(directory, `${artifactId}.html`)
}

function assertArtifactId(value: string) {
	if (!/^[a-z0-9-]+$/.test(value)) {
		throw new Error('Invalid snapshot artifact id.')
	}
}

function escapeScript(value: string) {
	return value.replace(/<\/script/gi, '<\\/script')
}

function escapeStyle(value: string) {
	return value.replace(/<\/style/gi, '<\\/style')
}

function createLocationPrelude(documentUrl: URL, archivePath: string) {
	const sourceLocation = `${documentUrl.pathname}${documentUrl.search}${documentUrl.hash}`
	return `(()=>{const prefix="data-snapshot-source-";const resources=[];for(const element of document.querySelectorAll("*")){for(const attribute of element.attributes){if(!attribute.name.startsWith(prefix))continue;const target=attribute.name.slice(prefix.length);const frozen=element.getAttribute(target);if(frozen)resources.push({tag:element.tagName,target,source:attribute.value,frozen})}}const freeze=()=>{for(const resource of resources){for(const element of document.querySelectorAll(resource.tag)){const current=element.getAttribute(resource.target);if(!current||current===resource.frozen)continue;let matches=current===resource.source;try{matches||=new URL(current,document.baseURI).href===resource.source}catch{}if(matches)element.setAttribute(resource.target,resource.frozen)}}};window.__devCanvasFreezeResources=freeze;new MutationObserver(freeze).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["href","src","srcset","poster"]});window.__devCanvasSnapshotUrl=${JSON.stringify(
		archivePath,
	)};history.replaceState(history.state,"",${JSON.stringify(sourceLocation)})})()`
}

function createLocationRestore(archivePath: string) {
	return `setTimeout(()=>{window.__devCanvasFreezeResources?.();history.replaceState(history.state,"",${JSON.stringify(
		archivePath,
	)})},5000)`
}

function formatBytes(value: number) {
	if (value < 1024) return `${value} B`
	if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
	return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
