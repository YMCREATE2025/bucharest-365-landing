# agent-edge Worker

Adds `Accept: text/markdown` negotiation (with `Vary: Accept`) and Markdown 404 bodies in front of the static GitHub Pages site.

1. Regenerate the Markdown twins after any page change: `python3 tools/build_markdown.py` (commit the `md/` folder).
2. Requires bucharest365.vip DNS proxied through Cloudflare.
3. `cd worker && npx wrangler deploy`, then add the route `bucharest365.vip/*`.
4. Verify:
   - `curl -sS -i -H 'Accept: text/markdown' https://bucharest365.vip/`  -> `content-type: text/markdown`, `vary: ... Accept`
   - `curl -sS -i -H 'Accept: text/html' https://bucharest365.vip/`  -> HTML, `vary: ... Accept`
   - `curl -sS -i -H 'Accept: text/markdown' https://bucharest365.vip/nope`  -> `404`, Markdown body
