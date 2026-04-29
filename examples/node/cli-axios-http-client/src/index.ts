import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import axios, { AxiosInstance, AxiosError } from 'axios';

interface Post {
  id?: number;
  title: string;
  body: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      if (req.method === 'GET' && url.startsWith('/posts/')) {
        const id = parseInt(url.slice('/posts/'.length), 10);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id, title: `Post #${id}`, body: `Body of post ${id}` }));
        return;
      }

      if (req.method === 'POST' && url === '/posts') {
        const raw = await readBody(req);
        const data: Post = JSON.parse(raw);
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...data, id: Math.floor(Math.random() * 1000) + 1 }));
        return;
      }

      if (req.method === 'GET' && url === '/slow') {
        await new Promise<void>((r) => setTimeout(r, 200));
        res.end('done');
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
    server.once('error', reject);
  });
}

async function main() {
  const srv = await startServer();
  const baseURL = `http://127.0.0.1:${srv.port}`;

  const client: AxiosInstance = axios.create({ baseURL, timeout: 5000 });

  client.interceptors.request.use((config) => {
    console.log(`→ ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  });

  // GET a post
  const getRes = await client.get<Post>('/posts/1');
  console.log(`GET /posts/1 → ${getRes.status} "${getRes.data.title}"`);

  // POST a new post
  const postRes = await client.post<Post>('/posts', { title: 'gjsify test', body: 'hello from GJS' });
  console.log(`POST /posts → ${postRes.status} id=${postRes.data.id}`);

  // Error handling — 404
  try {
    await client.get('/not-found');
  } catch (err) {
    const e = err as AxiosError;
    console.log(`GET /not-found → caught AxiosError status=${e.response?.status}`);
  }

  // Timeout — /slow with tight timeout
  try {
    await client.get('/slow', { timeout: 50 });
  } catch (err) {
    const e = err as AxiosError;
    console.log(`GET /slow (timeout=50ms) → caught ${e.code}`);
  }

  // Concurrent requests
  const ids = [2, 3, 4];
  const results = await Promise.all(ids.map((id) => client.get<Post>(`/posts/${id}`)));
  console.log(`Concurrent → ${results.map((r) => `"${r.data.title}"`).join(', ')}`);

  await srv.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
