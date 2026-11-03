// The worker side of `new Worker(url)`: a DedicatedWorkerGlobalScope-shaped
// surface (`self`, `postMessage`, `onmessage`, `addEventListener`, `close`,
// `name`) laid over the child's `parentPort`.
//
// It is a STRING because it has to run in a child that has no module system of
// its own: a bare `gjs` on GJS (the worker_threads bootstrap evaluates `eval`
// workers as an async function body), and a CommonJS `eval` script on Node.
// Both hand over a `parentPort`; Node's is a real MessagePort, GJS's an
// EventEmitter-shaped object, so only `on`/`off`/`postMessage`/`close` are used.
//
// The tail differs per runtime because the bootstrap awaits the value a body
// RETURNS, while a CommonJS script has no top-level `return`/`await`: without
// the return, GJS would call the script done, find nothing alive and exit
// before the dynamic import settles.

const SCOPE = `
const scope = globalThis;
const wrapped = { message: new Map(), messageerror: new Map() };
const event = (type, data) => ({ type, data, target: scope, currentTarget: scope, ports: [], origin: '', lastEventId: '', source: null });

scope.self = scope;
scope.name = %NAME%;
scope.postMessage = (value, options) => {
  const transfer = Array.isArray(options) ? options : options && options.transfer ? options.transfer : undefined;
  parentPort.postMessage(value, transfer);
};
scope.addEventListener = (type, listener) => {
  const registry = wrapped[type];
  if (!registry || registry.has(listener)) return;
  const fn = typeof listener === 'function' ? listener : listener && listener.handleEvent ? (e) => listener.handleEvent(e) : null;
  if (!fn) return;
  const forward = type === 'message' ? (data) => fn(event(type, data)) : () => fn(event(type, null));
  registry.set(listener, forward);
  parentPort.on(type, forward);
};
scope.removeEventListener = (type, listener) => {
  const registry = wrapped[type];
  const forward = registry && registry.get(listener);
  if (forward) { registry.delete(listener); parentPort.off(type, forward); }
};
scope.close = () => parentPort.close();
for (const type of ['message', 'messageerror']) {
  let holder = null;
  Object.defineProperty(scope, 'on' + type, {
    configurable: true,
    get: () => (holder ? holder.fn : null),
    set: (fn) => {
      if (holder) scope.removeEventListener(type, holder);
      holder = typeof fn === 'function' ? { fn, handleEvent: (e) => fn.call(scope, e) } : null;
      if (holder) scope.addEventListener(type, holder);
    },
  });
}
`;

const report = `(error) => {
  const context = globalThis.__gjsify_worker_context;
  if (context && context.crash) context.crash(error);
  else queueMicrotask(() => { throw error; });
}`;

/**
 * Eval-mode source for a worker: install the scope, then load `href`.
 * `gjs` selects the tail that RETURNS the import so the bootstrap awaits it.
 */
export function buildWorkerSource(href: string, name: string, gjs: boolean): string {
    const boot = `
${gjs ? '' : "const { parentPort } = require('node:worker_threads');"}
${SCOPE.replace('%NAME%', JSON.stringify(name))}
const boot = async () => { await import(${JSON.stringify(href)}); };
`;
    return gjs ? `${boot}\nreturn boot();` : `${boot}\nboot().catch(${report});`;
}
