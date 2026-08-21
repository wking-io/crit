# Crit website

The current `www` application is a local-only alpha demo and behavior reference. Its IndexedDB persistence and Cloudflare Pages deployment are not part of the target v1.

The stable shared UI ships as Workers Static Assets beside the Crit Worker API. Cloudflare Access supplies company identity, Crit applies Workspace authorization, and one Canvas Durable Object supplies canonical Canvas state.

During the rewrite, keep this app runnable only when it helps compare visible behavior. Do not add target collaboration features or persistence migrations to it. The new React application should be built in the target package graph described in [the architecture](../ARCHITECTURE.md).
