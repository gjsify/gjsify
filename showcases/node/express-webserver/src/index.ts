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
