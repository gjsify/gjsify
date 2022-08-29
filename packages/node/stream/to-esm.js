import { install } from 'esinstall';

await install(['vite-compatible-readable-stream'], {
    dest: './lib/esm',
    external: ['buffer', 'events']
});