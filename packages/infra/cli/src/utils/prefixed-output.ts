// Shared line-prefixed child-output forwarding for the parallel runners
// (`gjsify foreach`, `gjsify check`).
//
// Under GJS, `process.stdout.write` is a BLOCKING `Gio.write_all`. Writing
// each prefixed line LIVE during a PARALLEL run into a backpressuring pipe
// (a CI log collector that drains slowly) stalls the single GLib main loop
// on a full pipe → every parallel child's pipe backs up → their reads stall
// → the whole run HANGS. (A tty or file sink never backpressures, which is
// why this only ever bites in CI.) On a NON-tty sink we therefore BUFFER
// each child's prefixed output and flush it as ONE write when that child
// closes: the child is already done by then, so its own read can't stall,
// and concurrent flushes serialize into brief loop stalls instead of a
// deadlock. On a tty (interactive) lines are written live for responsive
// output.
//
// This helper is the single home for that logic — `foreach` shipped the fix
// first; `check` had an unbuffered copy that kept the hang class alive.

/**
 * Prefix every line of `src` with `prefix` and route it to `sink`. When
 * `buffered` is false (tty), lines are written live. When true (non-tty /
 * CI pipe), they are accumulated and emitted only by the returned `flush()`
 * — call it once the child has closed.
 */
export function prefixLines(
    src: NodeJS.ReadableStream,
    sink: NodeJS.WritableStream,
    prefix: string,
    buffered: boolean,
): () => void {
    let buf = '';
    let acc = '';
    const emit = (line: string): void => {
        if (buffered) acc += line;
        else sink.write(line);
    };
    src.setEncoding('utf-8');
    src.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
            emit(prefix + buf.slice(0, idx + 1));
            buf = buf.slice(idx + 1);
        }
    });
    src.on('end', () => {
        if (buf.length > 0) emit(prefix + buf + '\n');
    });
    return () => {
        if (acc.length > 0) {
            sink.write(acc);
            acc = '';
        }
    };
}
