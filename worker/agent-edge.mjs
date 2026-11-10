// Cloudflare Worker - agent-friendly edge for bucharest365.vip
//
// The site is static (GitHub Pages), which cannot vary a response by the Accept header.
// This Worker sits in front of it and adds:
//   1. Markdown content negotiation: `Accept: text/markdown` gets the Markdown twin from /md/*.md
//      with `Content-Type: text/markdown` and `Vary: Accept`. HTML clients still get HTML (also `Vary: Accept`).
//   2. Markdown 404 bodies (real HTTP 404) for agents that ask for text/markdown.
//
// Deploy: see worker/README.md. The Worker needs no secrets.

const SITE = 'https://bucharest365.vip';

// URL path -> Markdown twin under /md/
const MD_MAP = {
  '/': 'index', '/index.html': 'index', '/bachelor.html': 'bachelor', '/limos.html': 'limos',
  '/vip.html': 'vip', '/nightlife.html': 'nightlife', '/restaurants.html': 'restaurants',
  '/tips365.html': 'tips365', '/faq.html': 'faq', '/privacy.html': 'privacy',
  '/terms.html': 'terms', '/accessibility.html': 'accessibility',
};

// Parse an Accept header and return true when text/markdown is preferred over text/html.
export function prefersMarkdown(accept) {
  if (!accept) return false;
  const q = { md: -1, html: -1, any: -1 };
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';');
    let weight = 1;
    for (const p of params) {
      const m = p.trim().match(/^q=([0-9.]+)$/);
      if (m) weight = parseFloat(m[1]);
    }
    if (type === 'text/markdown') q.md = Math.max(q.md, weight);
    else if (type === 'text/html' || type === 'application/xhtml+xml') q.html = Math.max(q.html, weight);
    else if (type === '*/*' || type === 'text/*') q.any = Math.max(q.any, weight);
  }
  return q.md > 0 && q.md >= Math.max(q.html, 0);
}

function withVary(headers) {
  const h = new Headers(headers);
  const vary = (h.get('Vary') || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!vary.some((v) => v.toLowerCase() === 'accept')) vary.push('Accept');
  h.set('Vary', vary.join(', '));
  return h;
}

export function notFoundMarkdown(path) {
  return [
    '# 404 - Page not found',
    '',
    `The path \`${path}\` does not exist on bucharest365.vip.`,
    '',
    'Where to go next:',
    '',
    `- Agent guide and list of pages: ${SITE}/llms.txt`,
    `- Sitemap: ${SITE}/sitemap.xml`,
    `- Home page: ${SITE}/`,
    '',
  ].join('\n');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const wantsMd = request.method === 'GET' && prefersMarkdown(request.headers.get('Accept'));

    if (wantsMd) {
      const slug = MD_MAP[url.pathname];
      if (slug) {
        const origin = await fetch(`${SITE}/md/${slug}.md`, { headers: { Accept: 'text/plain' } });
        if (origin.ok) {
          return new Response(await origin.text(), {
            status: 200,
            headers: withVary({ 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' }),
          });
        }
      }
      // Static files (llms.txt, sitemap, images...) pass through untouched; only unknown paths become Markdown 404s.
      const probe = await fetch(request);
      if (probe.status !== 404) return new Response(probe.body, { status: probe.status, headers: withVary(probe.headers) });
      return new Response(notFoundMarkdown(url.pathname), {
        status: 404,
        headers: withVary({ 'Content-Type': 'text/markdown; charset=utf-8' }),
      });
    }

    const res = await fetch(request);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: withVary(res.headers) });
  },
};
