// Socket.IO chat server for GJS
// Adapted from refs/socket.io/examples/chat/index.js
// Copyright (c) 2014-2024 Damien Arrachequesne. MIT.
// Rewritten for GJS: plain http.createServer instead of express, gjsify transports.

import '@gjsify/node-globals/register';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, Socket } from 'socket.io';

const PORT = 3000;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
  const ext = extname(urlPath);
  if (!MIME[ext]) return false;

  const filePath = join(PUBLIC_DIR, urlPath);
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const httpServer = createServer((req, res) => {
  if (!serveStatic(req, res)) {
    res.writeHead(404);
    res.end('Not found');
  }
});

const io = new Server(httpServer, {
  transports: ['polling'],
  httpCompression: false,
});

// --- chat logic (ported verbatim from the original example) ---

let numUsers = 0;

io.on('connection', (socket: Socket & { username?: string }) => {
  let addedUser = false;

  socket.on('new message', (data: string) => {
    socket.broadcast.emit('new message', {
      username: socket.username,
      message: data,
    });
  });

  socket.on('add user', (username: string) => {
    if (addedUser) return;
    socket.username = username;
    ++numUsers;
    addedUser = true;
    socket.emit('login', { numUsers });
    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers,
    });
    console.log(`[chat] ${username} joined (${numUsers} online)`);
  });

  socket.on('typing', () => {
    socket.broadcast.emit('typing', { username: socket.username });
  });

  socket.on('stop typing', () => {
    socket.broadcast.emit('stop typing', { username: socket.username });
  });

  socket.on('disconnect', () => {
    if (addedUser) {
      --numUsers;
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers,
      });
      console.log(`[chat] ${socket.username} left (${numUsers} online)`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO chat server running → http://localhost:${PORT}`);
  console.log('Open the URL in a browser to start chatting.');
});
