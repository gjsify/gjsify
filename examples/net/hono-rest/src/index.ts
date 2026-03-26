// Hono REST API example for Node.js and GJS
// Demonstrates: Hono framework, JSON CRUD API, validation, http.createServer

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Data model
interface Todo {
  id: number;
  title: string;
  completed: boolean;
  created_at: string;
}

const todos: Todo[] = [
  { id: 1, title: 'Set up gjsify project', completed: true, created_at: new Date().toISOString() },
  { id: 2, title: 'Write REST API example', completed: false, created_at: new Date().toISOString() },
];
let nextId = 3;

// Create Hono app
const app = new Hono();

// GET / — API info
app.get('/', (c) => {
  return c.json({
    name: 'gjsify Todo API',
    runtime: runtimeName,
    endpoints: {
      'GET /todos': 'List all todos',
      'GET /todos/:id': 'Get a todo by ID',
      'POST /todos': 'Create a new todo',
      'PUT /todos/:id': 'Update a todo',
      'DELETE /todos/:id': 'Delete a todo',
    },
  });
});

// GET /todos — List all
app.get('/todos', (c) => {
  const completed = c.req.query('completed');
  let result = todos;
  if (completed === 'true') result = todos.filter((t) => t.completed);
  else if (completed === 'false') result = todos.filter((t) => !t.completed);
  return c.json({ todos: result, count: result.length });
});

// GET /todos/:id — Get one
app.get('/todos/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return c.json({ error: 'Todo not found' }, 404);
  return c.json({ todo });
});

// POST /todos — Create
app.post('/todos', async (c) => {
  const body = await c.req.json();
  const title = body?.title;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return c.json({ error: 'Title is required' }, 400);
  }
  const todo: Todo = {
    id: nextId++,
    title: title.trim(),
    completed: false,
    created_at: new Date().toISOString(),
  };
  todos.push(todo);
  return c.json({ todo }, 201);
});

// PUT /todos/:id — Update
app.put('/todos/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  const body = await c.req.json();
  if (body.title !== undefined) todo.title = String(body.title);
  if (body.completed !== undefined) todo.completed = Boolean(body.completed);
  return c.json({ todo });
});

// DELETE /todos/:id — Delete
app.delete('/todos/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return c.json({ error: 'Todo not found' }, 404);
  const [deleted] = todos.splice(index, 1);
  return c.json({ deleted });
});

// Adapter: Convert Node.js http request to Fetch API Request for Hono
const PORT = 3000;

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = `http://localhost:${PORT}${req.url || '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  // Read request body for POST/PUT
  let body: string | undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    body = await new Promise<string>((resolve) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => { data += chunk; });
      req.on('end', () => resolve(data));
    });
  }

  const fetchReq = new Request(url, {
    method: req.method,
    headers,
    body: body || undefined,
  });

  const fetchRes = await app.fetch(fetchReq);
  const resBody = await fetchRes.text();

  res.writeHead(fetchRes.status, {
    'content-type': fetchRes.headers.get('content-type') || 'application/json',
  });
  res.end(resBody);
});

server.listen(PORT, () => {
  console.log(`Hono REST API running at http://localhost:${PORT}`);
  console.log(`Runtime: ${runtimeName}`);
  console.log('Press Ctrl+C to stop');
});
