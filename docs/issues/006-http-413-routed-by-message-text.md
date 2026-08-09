# HTTP 413 vs 400 routed by error-message text

**Severity:** Low · **Area:** HTTP contract (`src/http/contract.ts`)

## Problem

The PATCH handler decides between 413 and 400 by string-matching the error
message: `cause.message.includes("exceeds")` (`src/http/contract.ts`, PATCH
error mapping). ARCHITECTURE.md's standard is typed failures ("Effect v4 owns
schemas, typed failures, …"); a copy edit to the message silently changes the
status code.

## Proposed fix

Give `readApplyRequest` a small typed failure union (e.g. `BodyTooLarge`,
`InvalidBody`) and map those to 413/400 explicitly. This also folds neatly into
the "one failure vocabulary" architecture candidate (issue 010).

## Origin

Standards review (correctness B6) of the 2026-08-09 architecture and code
review.
