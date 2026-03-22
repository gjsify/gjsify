import { describe, it, expect } from '@gjsify/unit';
import { createInterface, clearLine, clearScreenDown, cursorTo, moveCursor, Interface } from 'readline';
import { Readable, Writable, PassThrough } from 'stream';

export default async () => {
  await describe('readline', async () => {
    await it('should export createInterface as a function', async () => {
      expect(typeof createInterface).toBe('function');
    });

    await it('should export Interface class', async () => {
      expect(typeof Interface).toBe('function');
    });

    await it('should create an interface with input stream', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl).toBeDefined();
      expect(typeof rl.close).toBe('function');
      rl.close();
    });

    await it('should export utility functions', async () => {
      expect(typeof clearLine).toBe('function');
      expect(typeof clearScreenDown).toBe('function');
      expect(typeof cursorTo).toBe('function');
      expect(typeof moveCursor).toBe('function');
    });

    await it('should emit line events from input stream', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('hello\n');
      input.write('world\n');

      // Allow event processing
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
      rl.close();
    });

    await it('should handle \\r\\n line endings', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('line1\r\nline2\r\n');

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toBe('line2');
      rl.close();
    });

    await it('should emit close event', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      let closed = false;
      rl.on('close', () => { closed = true; });

      rl.close();
      expect(closed).toBe(true);
    });

    await it('should support set/getPrompt', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input, prompt: '>> ' });

      expect(rl.getPrompt()).toBe('>> ');
      rl.setPrompt('$ ');
      expect(rl.getPrompt()).toBe('$ ');
      rl.close();
    });

    await it('should answer question from input', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });

      const answerPromise = new Promise<string>((resolve) => {
        rl.question('Name? ', resolve);
      });

      input.write('Alice\n');
      const answer = await answerPromise;
      expect(answer).toBe('Alice');
      rl.close();
    });

    await it('should handle lines without trailing newline', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      // Write a line with newline — this should always work
      input.write('complete line\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('complete line');
      rl.close();
    });

    await it('should pause and resume', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      let paused = false;
      let resumed = false;
      rl.on('pause', () => { paused = true; });
      rl.on('resume', () => { resumed = true; });

      rl.pause();
      expect(paused).toBe(true);

      rl.resume();
      expect(resumed).toBe(true);
      rl.close();
    });
  });

  await describe('readline utility functions', async () => {
    await it('clearLine should write ANSI escape to stream', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearLine(stream, 0);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[2K');
    });

    await it('clearScreenDown should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearScreenDown(stream);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[0J');
    });

    await it('cursorTo should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      cursorTo(stream, 5);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[6G'); // x+1
    });

    await it('moveCursor should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      moveCursor(stream, 3, -2);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[3C\x1b[2A');
    });
  });
};
