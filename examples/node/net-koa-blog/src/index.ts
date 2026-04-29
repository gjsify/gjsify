// Reference: koajs/examples/blog (https://github.com/koajs/examples/tree/master/blog)
// Reimplemented with EJS templates for GJS using @gjsify/node-globals

import { runtimeName } from '@gjsify/runtime';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';

const app = new Koa();
const router = new Router();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Resolve views directory relative to this script (works in both Node.js ESM and GJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewsDir = join(__dirname, 'views');

// Template rendering helper
const templates = new Map<string, string>();

function getTemplate(name: string): string {
  if (!templates.has(name)) {
    templates.set(name, readFileSync(join(viewsDir, `${name}.ejs`), 'utf-8'));
  }
  return templates.get(name)!;
}

function renderView(name: string, data: Record<string, unknown> = {}): string {
  const body = ejs.render(getTemplate(name), data);
  return ejs.render(getTemplate('layout'), { ...data, body, title: data.title || 'Blog', platform: runtimeName });
}

// In-memory "database"

interface Post {
  id: number;
  title: string;
  body: string;
  created_at: Date;
}

const posts: Post[] = [];

// Routes

router.get('/', (ctx) => {
  ctx.type = 'html';
  ctx.body = renderView('list', { title: 'Posts', posts });
});

router.get('/post/new', (ctx) => {
  ctx.type = 'html';
  ctx.body = renderView('new', { title: 'New Post' });
});

router.get('/post/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const post = posts.find((p) => p.id === id);
  if (!post) {
    ctx.throw(404, 'Post not found');
    return;
  }
  ctx.type = 'html';
  ctx.body = renderView('show', { title: post.title, post });
});

router.post('/post', (ctx) => {
  const { title, body } = ctx.request.body as { title?: string; body?: string };
  if (!title || !body) {
    ctx.status = 400;
    ctx.type = 'html';
    ctx.body = renderView('new', { title: 'New Post' });
    return;
  }
  const post: Post = {
    id: posts.length,
    title,
    body,
    created_at: new Date(),
  };
  posts.push(post);
  ctx.redirect('/');
});

// JSON API (kept for programmatic access)

router.get('/api/posts', (ctx) => {
  ctx.body = { posts };
});

router.get('/api/posts/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const post = posts.find((p) => p.id === id);
  if (!post) {
    ctx.status = 404;
    ctx.body = { error: 'Post not found' };
    return;
  }
  ctx.body = { post };
});

// Middleware

app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

// Start the server
// On GJS, the MainLoop is started automatically by http.Server.listen().
app.listen(PORT, () => {
  console.log(`Koa blog running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
