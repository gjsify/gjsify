import { runtimeName } from '@gjsify/runtime';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/', (c) =>
    c.json({
        name: 'new-gjsify-app',
        runtime: runtimeName,
        endpoints: ['GET /', 'GET /api/ping'],
    }),
);

app.get('/api/ping', (c) => c.json({ ok: true, time: new Date().toISOString() }));

const PORT = parseInt(process.env.PORT ?? '3000', 10);
serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Hono server running at http://localhost:${info.port}`);
    console.log(`Runtime: ${runtimeName}`);
});
