# @gjsify/example-node-express-webserver

An Express 5 blog showcase — JSON API + static frontend — running on GJS using gjsify's Node.js polyfills (`@gjsify/http`, etc.). The same source also builds for Node.js, demonstrating that a real Express web application runs unmodified on GJS via the `@gjsify/*` Node API layer.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Run

```bash
# Build first
gjsify run build

# GJS (Express over GJS + Soup HTTP)
gjsify showcase express-webserver
# or: gjsify run start

# Node.js (for comparison)
gjsify run start:node
```

Then open `http://localhost:3000` in a browser.

## What it demonstrates

- Express 5 running on GJS with gjsify's `@gjsify/http` (Soup 3.0 backend)
- JSON REST API + static file serving from a single Express app
- Same source building for both `--app gjs` and `--app node` targets
- Node.js polyfill layer compatibility with an unmodified npm package

## License

MIT
