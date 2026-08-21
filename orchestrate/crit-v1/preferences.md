1. Build stable v1 as a clean rewrite. Do not preserve alpha APIs, storage, or runtime compatibility.
2. Treat the alpha as an executable behavior reference only. New code must not read or write alpha Canvas state.
3. Keep new implementation inside the target package graph until an explicit integration unit owns an old path.
4. One writer owns each file set. Parallel work must use disjoint paths.
5. Every unit ends with its exact focused checks. Do not advance a broken frontier.
6. Domain and protocol packages may not import platform, storage, React, Cloudflare, or transport adapters.
7. Commands contain intent only. Trusted boundaries stamp attribution, time, order, and authorization context.
8. Persist semantic changes as the canonical record. Projections are rebuildable views.
9. Frame identity is RepresentationRef from the first target schema.
10. Do not stage, commit, push, deploy, delete user data, or rewrite unrelated dirty files without explicit authorization.
