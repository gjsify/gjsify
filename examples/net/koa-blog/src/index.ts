// Reference: koajs/examples/blog (https://github.com/koajs/examples/tree/master/blog)
// Reimplemented as a JSON API for GJS using @gjsify/node-globals

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';

const app = new Koa();
const router = new Router();
const PORT = 3000;

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
  ctx.body = {
    message: `Koa Blog API running on ${runtimeName}`,
    routes: {
      'GET /': 'This overview',
      'GET /posts': 'List all posts',
      'GET /posts/:id': 'Show a single post',
      'POST /posts': 'Create a post (JSON body: { title, body })',
      'DELETE /posts/:id': 'Delete a post',
    },
  };
});

router.get('/posts', (ctx) => {
  ctx.body = { posts };
});

router.get('/posts/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const post = posts.find((p) => p.id === id);
  if (!post) {
    ctx.status = 404;
    ctx.body = { error: 'Post not found' };
    return;
  }
  ctx.body = { post };
});

router.post('/posts', (ctx) => {
  const { title, body } = ctx.request.body as { title?: string; body?: string };
  if (!title || !body) {
    ctx.status = 400;
    ctx.body = { error: 'Title and body are required' };
    return;
  }
  const post: Post = {
    id: posts.length,
    title,
    body,
    created_at: new Date(),
  };
  posts.push(post);
  ctx.status = 201;
  ctx.body = { post };
});

router.delete('/posts/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) {
    ctx.status = 404;
    ctx.body = { error: 'Post not found' };
    return;
  }
  const [deleted] = posts.splice(index, 1);
  ctx.body = { deleted };
});

// Middleware

app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

// Start the server
// On GJS, the MainLoop is started automatically by http.Server.listen().
app.listen(PORT, () => {
  console.log(`Koa blog API running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
