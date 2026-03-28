# @gjsify/unit

Lightweight testing framework for GJS and Node.js. Provides describe, it, expect with cross-platform support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/unit
# or
yarn add @gjsify/unit
```

## Usage

```typescript
import { describe, it, expect } from '@gjsify/unit';

export default async () => {
  await describe('MyModule', async () => {
    await it('should do something', async () => {
      expect(42).toBe(42);
      expect('hello').not.toEqual('world');
    });
  });
};
```

### Running tests

```bash
# Build and run on GJS
gjsify build test-runner.ts --platform gjs --outfile test.gjs.js
gjs -m test.gjs.js

# Run on Node.js
node test-runner.mjs
```

### Available matchers

- `toBe(value)` — strict equality (`===`)
- `toEqual(value)` — loose equality (`==`)
- `toMatch(regex)` — regex match
- `toBeDefined()` / `toBeUndefined()`
- `toBeNull()`
- `toBeTruthy()` / `toBeFalsy()`
- `toContain(needle)` — array contains
- `toBeLessThan(value)` / `toBeGreaterThan(value)`
- `toBeCloseTo(value, precision)` — float comparison
- `toThrow()` — expects function to throw
- `to(callback)` — custom matcher

All matchers support `.not` for negation.

### Spy

```typescript
import { spy } from '@gjsify/unit';

const f = spy();
f();
expect(f.calls.length).toBe(1);
```

## Credits

Forked from [gjsunit](https://github.com/philipphoffmann/gjsunit). Spy functionality forked from [mysticatea/spy](https://github.com/mysticatea/spy).

## License

MIT
