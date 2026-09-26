// A GJS web server whose page follows the desktop's accent and colour scheme
// (ADR 0078). The server reads the desktop, which a browser cannot, and hands the
// answer over twice:
//
//   - in the HTML, as <meta name="adw-accent"> / <meta name="adw-color-scheme">,
//     which @gjsify/adwaita-web applies on load, before the first paint;
//   - over Server-Sent Events, as JSON, whenever the user changes it in Settings.
//
// Run it, open http://localhost:3000, then change the accent in GNOME Settings.

import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type DesktopAppearance, renderAppearanceMeta, watchDesktopAppearance } from '@gjsify/adwaita-app/appearance';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const pageScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.js'), 'utf8');

const clients = new Set<ServerResponse>();
// Unknown until the first read lands, a few milliseconds after start: the page then
// simply renders no tags and picks the accent up over the event stream.
let current: DesktopAppearance = {};

function page(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Desktop appearance</title>
${renderAppearanceMeta(current)}
</head>
<body class="adw-root">
<adw-clamp>
<gtk-box orientation="vertical" spacing="12">
  <adw-preferences-group title="Follows your desktop" description="Change the accent or the style in Settings.">
    <adw-switch-row title="An accent-coloured switch" active></adw-switch-row>
    <adw-action-row title="The accent came from"><span slot="suffix" id="source"></span></adw-action-row>
  </adw-preferences-group>
  <gtk-button class="suggested-action" label="Suggested action"></gtk-button>
</gtk-box>
</adw-clamp>
<script type="module" src="/page.js"></script>
</body>
</html>`;
}

const server = createServer((req, res) => {
    if (req.url === '/page.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(pageScript);
    } else if (req.url === '/appearance') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        // The current value first: the page may have been rendered before the first read landed.
        res.write(`data: ${JSON.stringify(current)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
    } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page());
    }
});

// Listen BEFORE anything awaits: a server started after a top-level await exits at once
// on GJS today (status/open-todos.md). The watcher reports the first read, then each change.
server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));

// Held for the life of the server: the returned stop function keeps the D-Bus
// subscription (or the file monitor, or the poll) alive.
const stopWatching = watchDesktopAppearance((appearance) => {
    current = appearance;
    console.log(`Desktop appearance: ${JSON.stringify(appearance)}`);
    for (const client of clients) client.write(`data: ${JSON.stringify(appearance)}\n\n`);
});

process.on('SIGINT', () => {
    stopWatching();
    server.close();
    process.exit(0);
});
