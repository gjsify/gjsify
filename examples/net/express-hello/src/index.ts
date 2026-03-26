import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import express from 'express';

const app = express();
const PORT = 3000;

// GET / — Welcome page
app.get('/', (_req, res) => {
  res.json({
    message: `Hello from Express on ${runtimeName}`,
    routes: {
      'GET /': 'This welcome message',
      'GET /api/hello/:name': 'Greet someone by name',
      'GET /api/time': 'Current server time',
    },
  });
});

// GET /api/hello/:name — Greet by name
app.get('/api/hello/:name', (req, res) => {
  const { name } = req.params;
  res.json({ greeting: `Hello, ${name}!` });
});

// GET /api/time — Current time
app.get('/api/time', (_req, res) => {
  res.json({ time: new Date().toISOString() });
});

// Start the server
// On GJS, the MainLoop is started automatically by http.Server.listen().
app.listen(PORT, () => {
  console.log(`Express server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
