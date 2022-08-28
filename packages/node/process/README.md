# @gjsify/process [![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

process core module for [gjs](https://gitlab.gnome.org/GNOME/gjs) forked from [@cgjs/process](https://github.com/cgjs/cgjs/tree/master/packages/process)

## Currently usable

  * `abort()`
  * `arch`, via `require('os').arch()`
  * `argv`
  * `argv0`
  * `cwd()`
  * `env`
  * `exit([code])`
  * `nexttick(callback[, ...args])`, via `setImmediate(...)`
  * `pid`, via `new Gio.Credentials().get_unix_pid()`. Not sure yet it works for macOS
  * `platform`, via `require('os').platform()`
  * `title`, via `GLib.get_prgname()`
  * `version`, via cgjs `package.json` version
  * `uptime`, via `Date.now() - START_TIME`
  * `versions()`, via cgjs `package.json` dependencies

## Inspirations
- https://github.com/cgjs/cgjs/tree/master/packages/process
- https://github.com/denoland/deno_std/blob/main/node/process.ts
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/process.js
- https://github.com/aleclarson/process-browserify
- https://github.com/defunctzombie/node-process