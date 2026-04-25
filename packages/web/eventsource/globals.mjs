/**
 * Re-exports native EventSource global for use in Node.js builds.
 * On Node.js 22.3+, EventSource is available as a global (experimental).
 * TextLineStream is a gjsify utility — re-exported from the package.
 */
export const EventSource = globalThis.EventSource;

// TextLineStream is not a Web standard — it's a utility class from @gjsify/eventsource.
// Re-implement minimally for Node.js test compatibility.
export class TextLineStream extends TransformStream {
  constructor() {
    let buffer = '';
    super({
      transform(chunk, controller) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          controller.enqueue(line.endsWith('\r') ? line.slice(0, -1) : line);
        }
      },
      flush(controller) {
        if (buffer) controller.enqueue(buffer);
      }
    });
  }
}
