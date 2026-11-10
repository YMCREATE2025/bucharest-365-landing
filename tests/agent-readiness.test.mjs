// Run from the repo root:  node --test tests/agent-readiness.test.mjs   (or: npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker, { prefersMarkdown, notFoundMarkdown } from '../worker/agent-edge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const PAGES = ['index', 'bachelor', 'limos', 'vip', 'nightlife', 'restaurants', 'tips365', 'faq', 'privacy', 'terms', 'accessibility'];

test('every public page has an H1 as its first heading', () => {
  for (const p of PAGES) {
    const html = read(`${p}.html`).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    const first = html.match(/<h([1-6])[\s>]/);
    assert.ok(first, `${p}.html has no headings`);
    assert.equal(first[1], '1', `${p}.html: first heading is h${first[1]}, expected h1`);
  }
});

test('homepage serves substantial text in raw HTML', () => {
  const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.length > 500, `only ${text.length} chars`);
});

test('homepage JSON-LD is valid and carries product terms', () => {
  const m = read('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ld = JSON.parse(m[1]);
  assert.match(ld.keywords, /מסיבת רווקים בבוקרשט/);
  assert.ok(ld.knowsAbout.length >= 3);
  assert.ok(ld.serviceType.length >= 3);
  assert.equal(ld.hasOfferCatalog.itemListElement.length, 3);
  assert.match(read('index.html'), /<meta name="keywords" content="[^"]*מסיבת רווקים בבוקרשט/);
});

test('llms.txt follows the format and has when-to-use guidance', () => {
  const t = read('llms.txt');
  assert.match(t, /^# Bucharest365/m);
  assert.match(t, /^> .{40,}/m);
  assert.match(t, /^## When to use this site$/m);
  assert.match(t, /^## How an agent should call it$/m);
  assert.match(t, /https:\/\/wa\.me\/972544709642/);
  assert.match(t, /400 EUR[\s\S]*500 EUR[\s\S]*700 EUR/);
});

test('404.html is helpful and points agents to llms.txt and the sitemap', () => {
  const h = read('404.html');
  assert.match(h, /<h1>/);
  assert.match(h, /href="\/llms\.txt"/);
  assert.match(h, /href="\/sitemap\.xml"/);
  assert.match(h, /noindex/);
});

test('markdown twins exist for every public page', () => {
  for (const p of PAGES) {
    assert.ok(existsSync(join(ROOT, 'md', `${p}.md`)), `md/${p}.md missing`);
    const t = read(`md/${p}.md`);
    assert.ok(t.length > 300, `md/${p}.md too short`);
    assert.match(t, /^# /m);
    assert.doesNotMatch(t, /<script|<div/);
  }
  assert.match(read('md/bachelor.md'), /700€ לאדם · מינימום 10 חברים/);
});

test('prefersMarkdown parses Accept headers', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.5'), true);
  assert.equal(prefersMarkdown('text/html'), false);
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,*/*;q=0.8'), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
});

function mockOrigin() {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const { pathname } = new URL(url);
    if (pathname === '/md/index.md') return new Response('# Bucharest365\n\nHome in Markdown.', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    if (pathname === '/' || pathname === '/index.html') return new Response('<h1>Bucharest365</h1>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (pathname === '/llms.txt') return new Response('# Bucharest365', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    return new Response('<h1>404</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
  };
}

const req = (path, accept) => new Request(`https://bucharest365.vip${path}`, { headers: accept ? { Accept: accept } : {} });

test('worker: Accept text/markdown on / returns Markdown with Vary: Accept', async () => {
  mockOrigin();
  const r = await worker.fetch(req('/', 'text/markdown'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /^text\/markdown/);
  assert.match(r.headers.get('Vary'), /Accept/i);
  assert.match(await r.text(), /^# Bucharest365/);
});

test('worker: Accept text/html still returns HTML and Vary: Accept', async () => {
  mockOrigin();
  const r = await worker.fetch(req('/', 'text/html'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(r.headers.get('Vary'), /Accept/i);
  assert.match(await r.text(), /<h1>/);
});

test('worker: unknown path with text/markdown is a real 404 with a Markdown body', async () => {
  mockOrigin();
  const r = await worker.fetch(req('/does-not-exist', 'text/markdown'));
  assert.equal(r.status, 404);
  assert.match(r.headers.get('Content-Type'), /^text\/markdown/);
  const body = await r.text();
  assert.ok(body.length >= 20);
  assert.match(body, /llms\.txt/);
  assert.equal(body, notFoundMarkdown('/does-not-exist'));
});

test('worker: non-page assets pass through even when Accept is text/markdown', async () => {
  mockOrigin();
  const r = await worker.fetch(req('/llms.txt', 'text/markdown'));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '# Bucharest365');
});
