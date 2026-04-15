import { runtimeName } from '@gjsify/runtime';
import express, { type Request, type Response } from 'express';

const app = express();
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>new-gjsify-app</title></head>
  <body>
    <h1>new-gjsify-app</h1>
    <p>Runtime: <strong>${runtimeName}</strong></p>
    <p>Try <a href="/api/ping">GET /api/ping</a></p>
  </body>
</html>`);
});

app.get('/api/ping', (_req: Request, res: Response) => {
    res.json({ ok: true, runtime: runtimeName, time: new Date().toISOString() });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
    console.log(`Express server running at http://localhost:${PORT}`);
    console.log(`Runtime: ${runtimeName}`);
});
