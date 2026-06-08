# @gjsify/semver

Node-free semver implementation (parse, compare, satisfies, ranges) used by `gjsify install` and the CLI for dependency-version resolution on GJS. Supports caret, tilde, hyphen, x/star ranges, and OR (`||`) expressions. Runs on both Node.js and GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/semver
```

## Usage

```typescript
import { parse, compare, satisfies, maxSatisfying, SemVer, Range } from '@gjsify/semver';

// Parse and inspect a version
const v = parse('1.2.3-beta.1');
console.log(v?.major, v?.minor, v?.patch); // 1 2 3

// Compare two versions
compare('1.2.3', '1.2.4'); // -1

// Check whether a version satisfies a range
satisfies('1.5.0', '^1.2.0'); // true
satisfies('2.0.0', '^1.2.0'); // false

// Find the highest matching version in a list
maxSatisfying(['1.0.0', '1.5.0', '2.0.0'], '^1.2.0'); // '1.5.0'
```

## License

MIT
