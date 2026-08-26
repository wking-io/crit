---
name: crit-register-deployment
description: Register Crit preview Deployments in GitHub Actions after an application deploy. Use when the user asks to update CI, add a GitHub Action for Crit previews, wire wrangler pages deploy to crit register-deployment, or install the preview-registration skill.
---

# Register preview Deployments

The Frame stores `applicationId` and a route. CI replaces the Installation's review Deployment URL after each preview deploy.

## Start

1. Confirm `crit.manifest.json` exists at the project root. Done when it has `applicationId`.
2. Run `crit register-deployment --help`. Done when the live flags are in context. Prefer `--help` over this file for flag names.
3. Find the workflow that deploys the application preview. Done when you have the step that produces the preview origin.

If `crit` is not on PATH, use `npx crit`.

## Edit

Add a step after that deploy. Pass the preview origin as `--url` with a trailing slash. Pass `${{ github.sha }}` as `--revision` when the run has one.

```yaml
- name: Register the preview with Crit
  env:
    CRIT_INSTALLATION_URL: ${{ secrets.CRIT_INSTALLATION_URL }}
    CRIT_DEPLOY_TOKEN: ${{ secrets.CRIT_DEPLOY_TOKEN }}
    PREVIEW_URL: ${{ steps.deploy.outputs.deployment-url }}
  run: npx crit register-deployment --url "${PREVIEW_URL%/}/" --revision "${{ github.sha }}"
```

`--channel` defaults to `review`. Leave it unless the user named another channel.

Reuse the existing deploy job. Do not add a second pipeline that only registers.

## Secrets

Name these repository secrets. Do not commit values.

- `CRIT_INSTALLATION_URL` such as `https://crit.acme.internal`
- `CRIT_DEPLOY_TOKEN` matching the Installation Worker secret `CRIT_DEPLOY_TOKEN`

The token is a machine secret. It is not an Access user email and not `CLOUDFLARE_API_TOKEN`.

## Done

The workflow runs `crit register-deployment` after a successful preview deploy. `--url` comes from that deploy's origin. The two Crit secrets are named. No preview hostname is written onto a Frame, into `crit.manifest.json`, or into git.
