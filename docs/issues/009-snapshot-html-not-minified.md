# Snapshot HTML is not minified though README says it is

**Severity:** Low · **Area:** Snapshot Archive (`src/node/file-system-snapshot-archive.ts`)

## Problem

README: capture "bundles and minifies its HTML, CSS, and JavaScript." CSS and
JS go through esbuild with `minify: true`, but the HTML markup itself is only
comment-stripped and re-serialized (`file-system-snapshot-archive.ts:331-336`);
whitespace and markup are never minified.

## Proposed fix

Either minify the serialized HTML (collapse inter-tag whitespace outside
`pre`/`textarea`/`script`/`style` — the parser already treats those as block
text elements) or drop "HTML" from the README sentence. Given the 30 MiB
artifact limit, honest wording may be the better trade.

## Origin

Spec review ("Missing/Partial") of the 2026-08-09 architecture and code review.
