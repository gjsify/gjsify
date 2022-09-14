# Internal Bindings

This is forked from Deno, see [deno_std/node/internal_binding](https://github.com/denoland/deno_std/tree/main/node/internal_binding).

The modules in this directory implement (simulate) C++ bindings implemented in
the `./src/` directory of the [Node.js](https://github.com/nodejs/node)
repository.

These bindings are created in the Node.js source code by using
`NODE_MODULE_CONTEXT_AWARE_INTERNAL`.

Please refer to <https://github.com/nodejs/node/blob/master/src/README.md> for
further information.
