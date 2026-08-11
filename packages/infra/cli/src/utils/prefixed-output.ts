// Shared line-prefixed child-output forwarding for the parallel runners
// (`gjsify foreach`, `gjsify check`) — one home for it, because the second,
// unbuffered copy kept the hang below alive after the first was fixed.
//
// Under GJS `process.stdout.write` is a BLOCKING `Gio.write_all`. Writing lines
// live during a PARALLEL run into a backpressuring sink (a slow-draining CI log
// collector) stalls the single GLib main loop on a full pipe → every child's pipe
// backs up → their reads stall → the run HANGS. A tty or file sink never
// backpressures, which is why this only bites in CI. So on a NON-tty sink each
// child's output is buffered and flushed as ONE write after it closes: the child
// can no longer stall, and concurrent flushes serialize into brief loop stalls
// instead of a deadlock. A tty gets live lines, for responsiveness.

/**
 * Prefix every line of `src` with `prefix` and route it to `sink`. `buffered`
 * withholds everything until the returned `flush()` runs — call that only once
 * the child has closed.
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
