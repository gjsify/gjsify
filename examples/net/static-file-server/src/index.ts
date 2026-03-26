// Static file server example for Node.js and GJS
// Demonstrates: http.createServer, fs.createReadStream, fs.stat, fs.readdir,
// path.extname/join/resolve, stream.pipe, zlib.gzipSync

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import { createServer } from 'node:http';
import { createReadStream, stat, readdir, readFileSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stats } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(join(__dirname, 'public'));
const PORT = 3000;

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render a directory listing as HTML. */
function renderDirectoryListing(dirPath: string, urlPath: string, entries: string[]): string {
  const rows = entries
    .sort()
    .map((name) => `      <li><a href="${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`)
    .join('\n');

  const parentLink = urlPath !== '/' ? '      <li><a href="..">..</a></li>\n' : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Index of ${escapeHtml(urlPath)}</title>
  <style>
    body { font-family: monospace; margin: 2rem; background: #1e1e2e; color: #cdd6f4; }
    h1 { color: #89b4fa; }
    a { color: #a6e3a1; text-decoration: none; }
    a:hover { text-decoration: underline; }
    li { margin: 0.3rem 0; }
    footer { margin-top: 2rem; color: #6c7086; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Index of ${escapeHtml(urlPath)}</h1>
  <ul>
${parentLink}${rows}
  </ul>
  <footer>Served by @gjsify/static-file-server on ${escapeHtml(runtimeName)}</footer>
</body>
</html>`;
}

/** Promisify fs.stat. */
function statAsync(path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    stat(path, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

/** Promisify fs.readdir. */
function readdirAsync(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    readdir(path, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

/** Check if the client accepts gzip encoding. */
function acceptsGzip(req: IncomingMessage): boolean {
  const accept = (req.headers['accept-encoding'] as string) || '';
  return accept.includes('gzip');
}

/** Handle an incoming HTTP request. */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(req.url?.split('?')[0] || '/');

  // Normalize and resolve to prevent directory traversal
  const normalizedPath = normalize(urlPath);
  const filePath = join(PUBLIC_DIR, normalizedPath);

  // Security: ensure resolved path is within PUBLIC_DIR
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('403 Forbidden\n');
    return;
  }

  try {
    const stats = await statAsync(resolvedPath);

    if (stats.isDirectory()) {
      // Try to serve index.html from the directory
      const indexPath = join(resolvedPath, 'index.html');
      try {
        const indexStats = await statAsync(indexPath);
        if (indexStats.isFile()) {
          serveFile(req, res, indexPath, indexStats);
          return;
        }
      } catch {
        // No index.html — serve directory listing
      }

      // Ensure directory URLs end with /
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { location: urlPath + '/' });
        res.end();
        return;
      }

      const entries = await readdirAsync(resolvedPath);
      const html = renderDirectoryListing(resolvedPath, urlPath, entries);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (stats.isFile()) {
      serveFile(req, res, resolvedPath, stats);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found\n');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 Not Found\n');
    } else {
      console.error('Server error:', err);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('500 Internal Server Error\n');
    }
  }
}

/** Serve a file with optional gzip compression. */
function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string, stats: Stats): void {
  const mimeType = getMimeType(filePath);
  const headers: Record<string, string> = {
    'content-type': mimeType,
    'last-modified': stats.mtime.toUTCString(),
  };

  // Check If-Modified-Since
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince) {
    const clientDate = new Date(ifModifiedSince);
    if (stats.mtime <= clientDate) {
      res.writeHead(304);
      res.end();
      return;
    }
  }

  // Apply gzip for text-based content if client supports it
  const isTextual = mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('svg');

  if (isTextual && acceptsGzip(req)) {
    // Use gzipSync since @gjsify/zlib doesn't have createGzip (Transform stream)
    try {
      const raw = readFileSync(filePath);
      const compressed = gzipSync(raw);
      headers['content-encoding'] = 'gzip';
      headers['vary'] = 'Accept-Encoding';
      headers['content-length'] = String(compressed.length);
      res.writeHead(200, headers);
      res.end(Buffer.from(compressed));
    } catch (err) {
      console.error('Gzip error:', err);
      // Fallback: serve uncompressed via stream
      headers['content-length'] = String(stats.size);
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(res);
    }
  } else {
    // Serve uncompressed via fs.createReadStream().pipe(res)
    headers['content-length'] = String(stats.size);
    res.writeHead(200, headers);
    const stream = createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('File read error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' });
      }
      res.end('500 Internal Server Error\n');
    });
    stream.pipe(res);
  }
}

// Create and start the server
const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
    }
    res.end('500 Internal Server Error\n');
  });
});

server.listen(PORT, () => {
  console.log(`Static file server running at http://localhost:${PORT}`);
  console.log(`Serving files from: ${PUBLIC_DIR}`);
  console.log(`Runtime: ${runtimeName}`);
  console.log('Press Ctrl+C to stop');
});
