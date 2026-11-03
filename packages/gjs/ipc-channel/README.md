# @gjsify/ipc-channel

The message channel between two GJS processes: newline-framed JSON over a Gio stream pair, the
structured-clone wire codec, SharedBuffer fd transfer and cross-process `MessagePort` routing.
`@gjsify/worker_threads`' `Worker` runs on it, and `child_process.fork` will (ADR 0133). It knows
nothing about workers or `fork`; those decide what a message means.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. GJS only. Most apps never import
it directly; they use `worker_threads` or `child_process`.

## Installation

```bash
gjsify install @gjsify/ipc-channel
```

## Usage

```typescript
import { LineChannel, decode, encode } from '@gjsify/ipc-channel';

// `subprocess` is a Gio.Subprocess spawned with STDIN_PIPE | STDOUT_PIPE
const channel = new LineChannel(subprocess.get_stdin_pipe(), subprocess.get_stdout_pipe());
channel.startReading(
    (message) => console.log(decode(message.data)),
    () => console.log('peer closed'),
);
channel.send({ type: 'message', data: encode(new Map([[1, new Date()]])) });
```

| Export | What it does |
|---|---|
| `LineChannel` | One JSON text per line. The read loop ends on EOF or a line that is not JSON, never because a handler threw |
| `encode` / `decode` | Tagged JSON for the structured-clone types JSON cannot carry (Map, Set, Date, typed arrays, BigInt, Error, shared references) |
| `createDataCloneError` | The `DataCloneError` the HTML spec throws for an uncloneable value |
| `extractSharedBuffers` / `materializeSharedBuffers` | Replace `SharedBuffer`s with tagged placeholders, and back, around the SCM_RIGHTS side-channel |
| `SubprocessPortTransport` | `MessagePort` transport that routes a port's traffic over the channel by port id |

Everything but `LineChannel` is also exported from `@gjsify/ipc-channel/wire`, which imports no Gio
and runs on Node.js and in browsers as well.

## License

MIT
