# @gjsify/cluster

GJS stub implementation of the Node.js `cluster` module. Provides isPrimary and isWorker.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/cluster
# or
yarn add @gjsify/cluster
```

## Usage

```typescript
import cluster from '@gjsify/cluster';

if (cluster.isPrimary) {
  console.log('This is the primary process');
}
```

## License

MIT
