# Implementation workflow (TDD)

The standard porting workflow for a Node.js, Web or DOM API.

1. Study `refs/node/lib/<name>.js`.
2. Port tests using `@gjsify/unit`.
3. Run `gjsify run test:node` to verify the tests are correct.
4. Run `test:gjs` and expect failures.
5. Implement with `@girs/*`; consult `refs/{deno,bun,quickjs,workerd}/` as needed.
6. Iterate until both runtimes pass.
7. Run the full gate:

```bash
gjsify install --immutable && gjsify run clear && gjsify run build && gjsify run check && gjsify run test
```
