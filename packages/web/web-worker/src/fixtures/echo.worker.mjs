// Self-contained on purpose: the GJS child is a bare gjs with no module
// resolution, so this file may import nothing.
self.onmessage = (event) => {
    const data = event.data;
    if (data === 'report') return;
    if (data === 'close') {
        self.close();
        return;
    }
    if (data === 'throw') {
        setTimeout(() => {
            throw new TypeError('from-the-worker');
        }, 0);
        return;
    }
    if (data === 'listeners') {
        const seen = [];
        const a = () => seen.push('a');
        const b = { handleEvent: () => seen.push('b') };
        self.addEventListener('message', a);
        self.addEventListener('message', b);
        self.addEventListener('message', a);
        self.removeEventListener('message', a);
        self.addEventListener('message', (e) => {
            if (e.data === 'report') self.postMessage({ seen, self: self === globalThis });
        });
        self.postMessage('armed');
        return;
    }
    self.postMessage({ echo: data, name: self.name, type: event.type, ports: Array.isArray(event.ports) });
};
self.postMessage('ready');
