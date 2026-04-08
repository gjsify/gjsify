---
title: TDD Workflow
description: Test-driven workflow for porting Node.js and Web APIs to GJS
---

GJSify welcomes contributions! This page describes how we port new Node.js or Web APIs to GJS — a strict test-driven workflow that keeps both Node.js and GJS implementations honest.

If you have not set up the monorepo yet, start with [Development Setup](/gjsify/contributing/development-setup/).

## TDD Workflow

GJSify follows a test-driven development approach:

1. **Study the API** — read `refs/node/lib/<name>.js` for the canonical Node.js implementation (or the relevant `refs/deno/ext/…` file for Web APIs)
2. **Port tests** — write tests in `*.spec.ts` using `@gjsify/unit`
3. **Verify on Node.js** — `yarn test:node` — tests should pass against the real Node.js implementation first
4. **Test on GJS** — `yarn test:gjs` — expect failures, then fix the GJSify implementation
5. **Implement** — use `@girs/*` types, consult `refs/{deno,bun,quickjs,workerd}/` for reference
6. **Iterate** — until both platforms pass

## Testing Rules

- Tests must pass on **both Node.js and GJS**
- **Never weaken tests** to accommodate GJS limitations — fix the implementation instead
- Use the `node:` prefix for all Node.js imports in tests
- Use `@gjsify/unit` as the test framework; shared matchers: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toContain`, `toMatch`, `toThrow`
- Platform-specific test logic belongs in a separate `*.gjs.spec.ts` file or inside an `on('Gjs', …)` block — not sprinkled through the shared spec

## Full Validation

Before opening a pull request, run the full validation sequence:

```bash
yarn install && yarn clear && yarn build && yarn check && yarn test
```

This mirrors what CI does and catches most integration issues before review.

## Where to start

- Browse the [Packages Overview](/gjsify/packages/overview/) for modules that are still **Partial** or **Stub**
- Check open issues on [GitHub](https://github.com/gjsify/gjsify/issues)
- Improve documentation — this very site is in `website/src/content/docs/`
