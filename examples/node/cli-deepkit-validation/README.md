# @gjsify/example-cli-deepkit-validation

This example demonstrates the runtime type validation system of [@deepkit/type](https://deepkit.io/library/type) running on GJS via Gjsify.

## Features

- **Basic type guards** — `is<string>()`, `is<number>()` at runtime
- **Interface validation** — validate complex objects against TypeScript interfaces
- **Type constraints** — `MinLength`, `MaxLength`, `Positive`, `Email`, `Pattern`, etc.
- **Custom validators** — build your own validation logic with `Validate<>`
- **assert()** — throw on invalid data for input validation
- **Nested objects** — deep validation with dotted error paths
- **Union & literal types** — validate discriminated unions and string literals

## Build & Run

```bash
yarn build
yarn start:node   # Run on Node.js
yarn start:gjs    # Run on GJS
```
