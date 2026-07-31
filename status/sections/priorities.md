## Priorities / Next Steps

### High priority

1. **Real-world application examples** — validate the platform against real frameworks and use cases; each example must run on both Node.js and GJS. The current set (Express/Koa/Hono servers, SSE chat, WS/socket.io chat, static file server, CLI tools, SQLite/JSON stores, worker pool, SAB-native parallel SHA-256, GTK HTTP dashboard, axios client, deepkit examples, …) serves as integration validation and surfaces real CJS-ESM interop issues, missing globals, GC problems, and MainLoop edge cases that unit tests alone don't catch. Keep adding examples along new pillar work.
2. **Increase test coverage** — port more tests from `refs/node-test/` and `refs/bun/test/`, especially for networking (net, tls, dgram) and fs.

### Low priority

3. **cluster** — multi-process via a Gio.Subprocess pool.
4. **inspector** — GJS debugger integration (`gjs --debugger`).
