import { describe, expect, it } from 'vitest'
import { extractDocumentTitle } from './metadata'

describe('developer canvas URL metadata', () => {
	it('extracts and normalizes an HTML document title', () => {
		expect(
			extractDocumentTitle(`
				<!doctype html>
				<html>
					<head><title>A – Synth &amp; Sequencer</title></head>
				</html>
			`),
		).toBe('Synth & Sequencer')
	})

	it('returns null when a document has no meaningful title', () => {
		expect(extractDocumentTitle('<html><head></head></html>')).toBeNull()
		expect(extractDocumentTitle('<title>   </title>')).toBeNull()
	})
})
