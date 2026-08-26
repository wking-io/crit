#!/bin/sh
# The environment still ships a temporary Wooded Abstract token.
# That token overrides OAuth, so login has to drop it first.
unset CLOUDFLARE_API_TOKEN
unset CLOUDFLARE_ACCOUNT_ID
exec wrangler login --device --browser=false
