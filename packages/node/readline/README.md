# @gjsify/readline

GJS implementation of the Node.js `readline` module. Provides Interface, createInterface, question, prompt, and async iterator support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/readline

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/readline
yarn add @gjsify/readline
```

## Usage

```typescript
import { createInterface } from '@gjsify/readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('What is your name? ', (answer) => {
  console.log(`Hello, ${answer}!`);
  rl.close();
});
```

## License

MIT
