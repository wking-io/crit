# Crit playground

The current playground is the local-only alpha behavior lab. It remains useful while the clean rewrite ports selected interactions, but it is not the target architecture and its persisted state is disposable.

Run the existing behavior reference:

```sh
npm run dev:portless
```

Open `https://crit.localhost`. If stable HTTPS cannot bind, use `npm run dev` and the URL printed by Vite.

Use the playground to observe Canvas camera behavior, Frame and Note geometry, stacking, attachment, review states, snapshots, iframe lifecycle, shortcuts, input relay, and comment anchors. Record accepted behavior as target-system tests.

Do not use the playground's filesystem Canvas documents, IndexedDB, Git identity, manifest version 1, local HTTP routes, or current CLI output as stable v1 contracts.

The replacement playground will connect to `crit dev`, use logical Representations, and support two isolated replicas plus a disposable Cloudflare environment for collaboration proofs.
