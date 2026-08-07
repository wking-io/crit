import {
	normalizeItemTitle,
	normalizeUrl,
} from '../../app/modules/dev-canvas/model'

const MAX_DOCUMENT_BYTES = 256_000
const TITLE_TIMEOUT_MS = 5_000

export async function readUrlDocumentTitle(value: string) {
	try {
		const url = normalizeUrl(value)
		const response = await fetch(url, {
			headers: {
				Accept: 'text/html,application/xhtml+xml',
				'User-Agent': 'dev-canvas-title-resolver',
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
		})
		if (!response.ok) return null
		const contentType = response.headers.get('content-type')
		if (contentType && !contentType.includes('html')) return null
		return extractDocumentTitle(await readLimitedText(response))
	} catch {
		return null
	}
}

export function extractDocumentTitle(html: string) {
	const match = html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i)
	if (!match?.[1]) return null
	const title = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
	return title ? normalizeItemTitle(title) : null
}

async function readLimitedText(response: Response) {
	if (!response.body) return ''
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let result = ''
	let total = 0
	while (total < MAX_DOCUMENT_BYTES) {
		const { done, value } = await reader.read()
		if (done) break
		if (!value) continue
		const remaining = MAX_DOCUMENT_BYTES - total
		const chunk =
			value.byteLength > remaining ? value.slice(0, remaining) : value
		total += chunk.byteLength
		result += decoder.decode(chunk, { stream: total < MAX_DOCUMENT_BYTES })
		if (chunk.byteLength < value.byteLength) {
			await reader.cancel()
			break
		}
	}
	result += decoder.decode()
	return result
}

function decodeHtmlEntities(value: string) {
	const named: Record<string, string> = {
		amp: '&',
		apos: "'",
		gt: '>',
		lt: '<',
		quot: '"',
	}
	return value.replace(
		/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
		(entity, decimal: string, hexadecimal: string, name: string) => {
			const codePoint = decimal
				? Number.parseInt(decimal, 10)
				: hexadecimal
					? Number.parseInt(hexadecimal, 16)
					: undefined
			if (codePoint !== undefined && Number.isFinite(codePoint)) {
				try {
					return String.fromCodePoint(codePoint)
				} catch {
					return entity
				}
			}
			return named[name?.toLowerCase()] ?? entity
		},
	)
}
