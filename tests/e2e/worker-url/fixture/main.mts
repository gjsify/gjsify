import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./outer.mts', import.meta.url));
worker.on('message', (msg) => {
    console.log(`WORKER_URL_REPLY=${msg}`);
    void worker.terminate();
});
