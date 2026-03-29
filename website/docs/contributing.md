---
sidebar_position: 5
title: Contributing
---

# Contributing

gjsify welcomes contributions! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/gjsify/gjsify.git
cd gjsify
corepack enable
yarn install
yarn build
yarn test
```

## TDD Workflow

gjsify follows a test-driven development approach:

1. **Study the API**: Read `refs/node/lib/<name>.js` for the canonical Node.js implementation
2. **Port tests**: Write tests in `*.spec.ts` using `@gjsify/unit`
3. **Verify on Node.js**: `yarn test:node` — tests should pass against Node.js
4. **Test on GJS**: `yarn test:gjs` — expect failures, then fix the implementation
5. **Implement**: Use `@girs/*` types, consult `refs/{deno,bun,quickjs}/` for reference
6. **Iterate**: Until both platforms pass

## Testing Rules

- Tests must pass on **both Node.js and GJS**
- Never weaken tests to accommodate GJS limitations — fix the implementation
- Use `node:` prefix for all Node.js imports in tests
- Use `@gjsify/unit` as the test framework

## Full Validation

```bash
yarn install && yarn clear && yarn build && yarn check && yarn test
```
