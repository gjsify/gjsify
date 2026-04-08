// Express.js blog showcase for @gjsify/cli.
// A small blog application with a JSON REST API and a static HTML/CSS frontend,
// running on Express.js — the exact same code you would write for Node.js,
// executed natively on Linux via GJS.

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import { posts } from './data/posts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// --- HTML helpers -----------------------------------------------------------

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderContent(text: string): string {
    return text
        .split(/\n\n+/)
        .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br />')}</p>`)
        .join('\n        ');
}

function renderPage(title: string, bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — GJSify Blog</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <a href="/" class="brand-link">
        <h1>GJSify Blog</h1>
        <p class="tagline">Express.js, running natively on Linux via GJS</p>
      </a>
    </div>
    <div class="runtime" id="runtime">Loading runtime…</div>
  </header>
${bodyHtml}
  <footer class="site-footer">
    <p>Served by <code>@gjsify/example-node-express-webserver</code></p>
    <p class="hint">Try the API directly: <a href="/api/posts">/api/posts</a></p>
  </footer>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

// --- Middleware -------------------------------------------------------------

app.use(express.json());

// Simple access log
app.use((req, _res, next) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

// --- JSON API ---------------------------------------------------------------

// GET /api/posts — list all posts (without full content)
app.get('/api/posts', (_req: Request, res: Response) => {
    res.json({
        count: posts.length,
        posts: posts.map(({ id, slug, title, author, date, excerpt }) => ({
            id, slug, title, author, date, excerpt,
        })),
    });
});

// GET /api/posts/:slug — single post
app.get('/api/posts/:slug', (req: Request, res: Response) => {
    const post = posts.find((p) => p.slug === req.params.slug);
    if (!post) {
        res.status(404).json({ error: 'Post not found' });
        return;
    }
    res.json(post);
});

// GET /api/runtime — info about the runtime this server is running on
app.get('/api/runtime', (_req: Request, res: Response) => {
    res.json({
        runtime: runtimeName,
        platform: process.platform,
        version: process.version,
        time: new Date().toISOString(),
    });
});

// --- HTML pages -------------------------------------------------------------

// GET /posts/:slug — server-rendered article page
app.get('/posts/:slug', (req: Request, res: Response) => {
    const post = posts.find((p) => p.slug === req.params.slug);
    if (!post) {
        res.status(404).send(renderPage('Post not found', `
  <main class="post-detail">
    <a href="/" class="back-link">← Back to posts</a>
    <p class="loading">Post not found.</p>
  </main>`));
        return;
    }

    res.send(renderPage(post.title, `
  <main class="post-detail">
    <a href="/" class="back-link">← Back to posts</a>
    <article>
      <h2 class="post-title">${escapeHtml(post.title)}</h2>
      <p class="meta">
        <span class="author">${escapeHtml(post.author)}</span>
        <span class="date">${escapeHtml(post.date)}</span>
      </p>
      <div class="post-content">
        ${renderContent(post.content)}
      </div>
    </article>
  </main>`));
});

// --- Static frontend --------------------------------------------------------

app.use(express.static(PUBLIC_DIR));

// --- Start ------------------------------------------------------------------

app.listen(PORT, () => {
    console.log('');
    console.log(`  Express.js blog running on ${runtimeName}`);
    console.log('');
    console.log(`  ➜  Local:    http://localhost:${PORT}/`);
    console.log(`  ➜  API:      http://localhost:${PORT}/api/posts`);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
});
