// Registers: queueMicrotask

if (typeof queueMicrotask !== 'function') {
  Object.defineProperty(globalThis, 'queueMicrotask', {
    value: function queueMicrotask(callback: VoidFunction): void {
      Promise.resolve().then(callback).catch((err) => {
        setTimeout(() => { throw err; }, 0);
      });
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
