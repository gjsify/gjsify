import { Worker, parentPort } from 'node:worker_threads';

const inner = new Worker(new URL('./inner.mts', import.meta.url));
inner.on('message', (msg) => {
    parentPort?.postMessage(`outer>${msg}`);
    void inner.terminate();
});
