// axios HTTP client demo — adapted from the official axios TypeScript example
// at https://axios.rest/pages/getting-started/examples/typescript.html.
// Uses https://jsonplaceholder.typicode.com (a free fake REST API) so the demo
// exercises real HTTPS, JSON parsing, and concurrent requests on Node.js + GJS.

import axios, { AxiosInstance, AxiosError } from 'axios';

interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

interface User {
  id: number;
  name: string;
  username: string;
  email: string;
}

const api: AxiosInstance = axios.create({
  baseURL: 'https://jsonplaceholder.typicode.com',
  timeout: 10_000,
  headers: { 'Accept': 'application/json' },
});

api.interceptors.request.use((config) => {
  console.log(`→ ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
  return config;
});

// GET — fetch a single post
const post = await api.get<Post>('/posts/1');
console.log(`GET /posts/1 → ${post.status} "${post.data.title}"`);

// GET — list with query params (typed)
const userPosts = await api.get<Post[]>('/posts', { params: { userId: 1 } });
console.log(`GET /posts?userId=1 → ${userPosts.data.length} posts`);

// POST — create a new post
const created = await api.post<Post>('/posts', {
  userId: 1,
  title: 'gjsify demo',
  body: 'hello from axios on GJS + Node.js',
});
console.log(`POST /posts → ${created.status} id=${created.data.id}`);

// PUT — replace a post
const updated = await api.put<Post>('/posts/1', {
  id: 1,
  userId: 1,
  title: 'updated title',
  body: 'updated body',
});
console.log(`PUT /posts/1 → ${updated.status} title="${updated.data.title}"`);

// DELETE — remove a post
const deleted = await api.delete('/posts/1');
console.log(`DELETE /posts/1 → ${deleted.status}`);

// Error handling — 404
try {
  await api.get('/posts/0');
} catch (err) {
  const e = err as AxiosError;
  console.log(`GET /posts/0 → caught AxiosError status=${e.response?.status}`);
}

// Concurrent requests — fetch a post and its author in parallel
const [postRes, authorRes] = await Promise.all([
  api.get<Post>('/posts/2'),
  api.get<User>('/users/1'),
]);
console.log(`Concurrent → post="${postRes.data.title}" by ${authorRes.data.name} <${authorRes.data.email}>`);

console.log('Done.');

// GJS keeps the GLib MainLoop alive after the last HTTPS request settles;
// exit explicitly so the CLI returns control to the shell on both runtimes.
// Note: top-level await is required here — `main().then(...)` would let the GJS
// module finish synchronously and Soup callbacks would never fire.
process.exit(0);
