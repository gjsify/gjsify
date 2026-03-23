/**
 * Defer an event emission to the next macrotask, matching Node.js behavior
 * for server 'listening', 'close', and 'error' events.
 */
export function deferEmit(
  emitter: { emit(event: string | symbol, ...args: unknown[]): boolean },
  event: string,
  ...args: unknown[]
): void {
  setTimeout(() => emitter.emit(event, ...args), 0);
}
