# Crit website

`www` is the public Crit site: the landing page **is** the Crit canvas. It is a
separate Vite app from the playground, built from the same `@riff-refine/crit`
package so editor UI changes apply here too.

Visitors can pan and zoom immediately. Adding Frames or Notes requires Sign-in
(name and email). Mutations stay in the browser via IndexedDB.

## Local

From the repository root:

```sh
npm run www:dev
```

Open `http://127.0.0.1:4173`. Frame pages:

- `/hero`
- `/features`
- `/signup`

## Deploy to Cloudflare Pages

```sh
npm run www:build
npx wrangler pages deploy www/dist --project-name crit
```

`www/wrangler.toml` points Pages at `./dist`. The SPA `_redirects` file serves
`/hero`, `/features`, and `/signup` as the same app so live Frames resolve.
