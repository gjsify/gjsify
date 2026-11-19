# @gjsify/webserial

The [Web Serial API](https://wicg.github.io/serial/) for GJS: `Serial`, `SerialPort` and `navigator.serial`, with streams for reading and writing. The Linux backend opens a **classic Bluetooth serial port** (RFCOMM, Serial Port Profile) through BlueZ. It needs no `rfcomm` binary and no `/dev/rfcomm*` node.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webserial

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webserial
yarn add @gjsify/webserial
```

## Usage

Pair and trust the device first (`bluetoothctl pair <mac>`, `bluetoothctl trust <mac>`). Most devices accept one connection at a time, so disconnect a phone before opening the port.

```typescript
import { BluezRfcommSource, Serial } from '@gjsify/webserial';

const serial = new Serial(new BluezRfcommSource());

const [port] = await serial.getPorts();           // bonded devices that offer a serial port
await port.open({ baudRate: 115200 });            // a Bluetooth link ignores the rate

const writer = port.writable!.getWriter();
await writer.write(new Uint8Array([0x1f, 0x11, 0x38]));
writer.releaseLock();

await port.close();
```

`requestPort()` takes the same filters as the browser API. A GJS program has no chooser dialog, so pass your own to the `Serial` constructor; the default takes the first candidate:

```typescript
const serial = new Serial(new BluezRfcommSource(), {
    chooser: async (candidates) => candidates.find((c) => c.name === 'P12Pro') ?? null,
});
const port = await serial.requestPort({ filters: [{ bluetoothServiceClassId: '00001101-0000-1000-8000-00805f9b34fb' }] });
```

### Globals

```typescript
import '@gjsify/webserial/register'; // or let `--globals auto` do it
```

sets `navigator.serial`, `Serial` and `SerialPort`, and never replaces ones a runtime already has.

### Other platforms

The backend sits behind the small `PortSource` interface (`available`, `list`, `connect`, optional `subscribe`). `FakeSource` implements it in memory for tests; another driver (USB serial, macOS IOBluetooth) only has to provide the same four calls.

## What is not implemented

- Control signals: `setSignals()` and `getSignals()` throw `NotSupportedError`. A Bluetooth serial link has none.
- USB serial ports.
- Baud rate, parity and flow control are accepted and ignored on the RFCOMM link.

## Verification

The BlueZ recipe was measured against a real Bluetooth label printer: the initialisation exchange answered on all six packets, and a printed label followed. `FakeSource` covers the stream and error behaviour in the unit tests; no CI runner has a Bluetooth device.

## License

MIT
