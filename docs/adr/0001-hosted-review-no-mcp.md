# Hosted human review, no remote MCP

Authors build canvases locally with the UI, CLI, and local agents. After share, teammates review in the hosted Crit UI through Cloudflare Access. They do not install Crit. Agents do not operate on the shared installation. Crit has no MCP server and no OAuth agent grants.

Remote Code Mode MCP was the previous v1 plan. It is out because shipped review is human-led, and a teammate should not need a local daemon or an agent endpoint to participate.
