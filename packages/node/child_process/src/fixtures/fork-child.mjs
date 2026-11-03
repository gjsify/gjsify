// The child half of fork.spec.ts. Bundled twice — `--app gjs` and `--app node` —
// so each parent runtime can fork a child of either runtime over the same wire.
import process from 'node:process';

const mode = process.argv[2];

if (mode === 'info') {
    process.send(
        {
            connected: process.connected,
            fd: process.env.NODE_CHANNEL_FD ?? null,
            serialization: process.env.NODE_CHANNEL_SERIALIZATION_MODE ?? null,
            args: process.argv.slice(3),
        },
        () => process.disconnect(),
    );
} else if (mode === 'echo') {
    process.on('message', (message) => {
        if (message === 'bye') process.disconnect();
        else process.send({ echo: message });
    });
} else if (mode === 'wait') {
    // Only the 'disconnect' listener keeps this child alive.
    process.on('disconnect', () => {
        process.exitCode = 7;
    });
}
