// Tests for readline/promises module
// Reference: Node.js lib/readline/promises.js

import { describe, it, expect } from '@gjsify/unit';
import { createInterface, Interface } from 'node:readline/promises';
import { Readable, Writable, PassThrough } from 'node:stream';

export default async () => {
  await describe('readline/promises', async () => {
    await it('should export createInterface function', async () => {
      expect(typeof createInterface).toBe('function');
    });

    await it('should export Interface class', async () => {
      expect(Interface).toBeDefined();
    });

    await it('should create an interface with input stream', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      expect(rl).toBeDefined();
      expect(rl instanceof Interface).toBe(true);
      rl.close();
    });

    await it('should create an interface with input and output', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });
      expect(rl).toBeDefined();
      rl.close();
    });

    await it('should read lines via async iterator', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      const done = (async () => {
        for await (const line of rl) {
          lines.push(line);
        }
      })();

      input.write('hello\n');
      input.write('world\n');
      input.end();

      await done;
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
    });

    await it('question should return a promise', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });

      // Schedule the answer
      setTimeout(() => {
        input.write('my answer\n');
      }, 10);

      const answer = await rl.question('What? ');
      expect(answer).toBe('my answer');
      rl.close();
    });

    await it('should handle multiple questions sequentially', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });

      setTimeout(() => {
        input.write('first\n');
      }, 10);

      const answer1 = await rl.question('Q1? ');
      expect(answer1).toBe('first');

      setTimeout(() => {
        input.write('second\n');
      }, 10);

      const answer2 = await rl.question('Q2? ');
      expect(answer2).toBe('second');

      rl.close();
    });

    await it('should close properly', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      let closed = false;
      rl.on('close', () => { closed = true; });
      rl.close();

      // Give event loop a tick
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(true);
    });

    await it('should emit line events', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('line1\nline2\n');
      input.end();

      // Wait for processing
      await new Promise<void>((resolve) => rl.on('close', resolve));
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toBe('line2');
    });
  });
};
