# Deploy the hosted review Worker

1. Run `npm run hosted:deploy`. The command builds `@crit/host`, validates its HTML, stages the Vite output in `dist-assets/`, and deploys the production Wrangler environment.
2. Put the Worker hostname behind Cloudflare Access. The Worker trusts `Cf-Access-Authenticated-User-Email` and does not implement login. Worker code serves the HTML shell without authentication. Access redirects a fresh unauthenticated navigation before the request reaches the Worker.
3. Keep hosted fetch credentials unset. The browser default `same-origin` mode sends the `CF_Authorization` cookie. The client does not stamp the Access email header.
4. Set the production deploy token with `npx wrangler secret put CRIT_DEPLOY_TOKEN --config packages/cloudflare/wrangler.jsonc --env production`.
5. Run `curl -H 'Accept: text/html' https://crit.example/` after deployment. The document must contain a hashed `/assets/*.js` module script and must not contain `/src/main.tsx`.
6. Keep preview `frame-ancestors` and Access `allow_iframe` work in the next inventory item.
