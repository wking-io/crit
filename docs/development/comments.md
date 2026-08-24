# Comments

Comments are a stable v1 Canvas capability for people and Agents.

## Domain

A Comment Thread belongs to one Canvas and targets a Frame. A thread contains:

- A stable ID.
- Its Frame ID.
- An optional normalized visual or element anchor.
- Ordered messages with stable IDs and Actor snapshots.
- Open or resolved state.
- Creation and resolution provenance.

Comments are semantic Canvas commands and become canonical only when their containing change is accepted. Clients do not supply trusted Actor identity or timestamps.

Workspace policy authorizes commenting and resolution. Canvas creation and thread authorship do not grant special authority. Product policy may allow an author to edit their own message, but identity comparison uses the server-stamped Actor.

## Live and captured Frames

For a live Application Route, the Frame Bridge reports route, revision, selectors, fingerprints, normalized geometry, and anchor health. The UI must show when an anchor is stale or cannot be resolved.

For an Artifact, the immutable artifact digest identifies the rendered content. Frame-level normalized anchors are supported. DOM-element anchors require a stable DOM map stored with the capture; otherwise the UI degrades them visibly instead of guessing.

## Agent authorship

An Agent-authored comment names the Agent as author. Its accepted change also records the local Person who ran the Agent, the execution, and optional reported runtime metadata. The UI must not present that Person as the author. Agents author comments only during local work. Shared review comments come from People.

## Verification

Tests cover create, reply, edit, resolve, reopen, anchor degradation, deleted Frames, offline replay, Agent attribution, unauthorized access, and hostile Frame Bridge messages.
