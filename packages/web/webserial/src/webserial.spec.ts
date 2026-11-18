import { describe, expect, it } from '@gjsify/unit';

import { FakeSource, Serial, canonicalUuid } from './index.js';
import type { PortHandle } from './index.js';

const SPP = '00001101-0000-1000-8000-00805f9b34fb';
const printer: PortHandle = {
    id: '/dev/a',
    name: 'Printer A',
    info: { bluetoothServiceClassId: SPP },
};
const other: PortHandle = { id: '/dev/b', name: 'Other', info: { usbVendorId: 0x1234, usbProductId: 1 } };

const bytes = (...v: number[]) => new Uint8Array(v);

async function rejects(promise: Promise<unknown>): Promise<{ name: string; message: string }> {
    try {
        await promise;
    } catch (error) {
        return error as { name: string; message: string };
    }
    throw new Error('expected a rejection');
}

export default async () => {
    await describe('canonicalUuid', async () => {
        await it('expands 16-bit and 32-bit ids to the Bluetooth base UUID', async () => {
            expect(canonicalUuid(0x1101)).toBe(SPP);
            expect(canonicalUuid('1101')).toBe(SPP);
            expect(canonicalUuid('00001101')).toBe(SPP);
            expect(canonicalUuid(SPP.toUpperCase())).toBe(SPP);
        });
        await it('refuses what is not a service class id', async () => {
            let threw = false;
            try {
                canonicalUuid('nope');
            } catch (e) {
                threw = e instanceof TypeError;
            }
            expect(threw).toBe(true);
        });
    });

    await describe('Serial.getPorts / requestPort', async () => {
        await it('returns the same SerialPort object for the same id', async () => {
            const serial = new Serial(new FakeSource([printer, other]));
            const a = await serial.getPorts();
            const b = await serial.getPorts();
            expect(a.length).toBe(2);
            expect(a[0] === b[0]).toBe(true);
        });

        await it('is empty, not an error, when the platform service is missing', async () => {
            const source = new FakeSource([printer]);
            source.isAvailable = false;
            const serial = new Serial(source);
            expect((await serial.getPorts()).length).toBe(0);
            expect((await rejects(serial.requestPort())).name).toBe('NotSupportedError');
        });

        await it('filters by Bluetooth service class and by USB ids', async () => {
            const serial = new Serial(new FakeSource([printer, other]));
            const bt = await serial.requestPort({ filters: [{ bluetoothServiceClassId: 0x1101 }] });
            expect(bt.getInfo().bluetoothServiceClassId).toBe(SPP);
            const usb = await serial.requestPort({ filters: [{ usbVendorId: 0x1234 }] });
            expect(usb.getInfo().usbProductId).toBe(1);
        });

        await it('answers NotFoundError when no candidate matches or the chooser declines', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const none = await rejects(serial.requestPort({ filters: [{ usbVendorId: 1 }] }));
            expect(none.name).toBe('NotFoundError');
            const declined = new Serial(new FakeSource([printer]), { chooser: () => null });
            expect((await rejects(declined.requestPort())).name).toBe('NotFoundError');
        });

        await it('rejects malformed filters like the spec', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const empty = await rejects(serial.requestPort({ filters: [{}] }));
            expect(empty.name).toBe('TypeError');
            const product = await rejects(serial.requestPort({ filters: [{ usbProductId: 1 }] }));
            expect(product.name).toBe('TypeError');
            const mixed = await rejects(
                serial.requestPort({ filters: [{ usbVendorId: 1, bluetoothServiceClassId: 0x1101 }] }),
            );
            expect(mixed.name).toBe('TypeError');
        });
    });

    await describe('SerialPort', async () => {
        await it('writes through the writable stream and reads through the readable one', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            const [port] = await serial.getPorts();
            expect(port.readable === null).toBe(true);
            await port.open({ baudRate: 9600 });
            expect(port.connected).toBe(true);

            const writer = port.writable!.getWriter();
            await writer.write(bytes(1, 2, 3));
            writer.releaseLock();
            expect(Array.from(source.connections[0].written[0]).join(',')).toBe('1,2,3');

            source.connections[0].push(bytes(0x1a, 0x0f));
            const reader = port.readable!.getReader();
            const { value, done } = await reader.read();
            expect(done).toBe(false);
            expect(Array.from(value!).join(',')).toBe('26,15');
            reader.releaseLock();
            await port.close();
            expect(port.connected).toBe(false);
            expect(port.readable === null).toBe(true);
            expect(source.connections[0].closed).toBe(true);
        });

        await it('refuses to open twice and to close when closed', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const [port] = await serial.getPorts();
            expect((await rejects(port.close())).name).toBe('InvalidStateError');
            await port.open({ baudRate: 9600 });
            expect((await rejects(port.open({ baudRate: 9600 }))).name).toBe('InvalidStateError');
            await port.close();
            await port.open({ baudRate: 9600 });
            await port.close();
        });

        await it('validates the open options', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const [port] = await serial.getPorts();
            expect((await rejects(port.open({ baudRate: 0 }))).name).toBe('TypeError');
            expect((await rejects(port.open({ baudRate: 9600, bufferSize: 0 }))).name).toBe('TypeError');
        });

        await it('refuses to close while a stream is locked', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const [port] = await serial.getPorts();
            await port.open({ baudRate: 9600 });
            const writer = port.writable!.getWriter();
            expect((await rejects(port.close())).name).toBe('TypeError');
            writer.releaseLock();
            await port.close();
        });

        await it('closes cleanly with a read still pending in the stream', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const [port] = await serial.getPorts();
            await port.open({ baudRate: 9600 });
            const reader = port.readable!.getReader();
            const pending = reader.read();
            reader.releaseLock();
            await pending.catch(() => undefined);
            await port.close();
        });

        await it('reports a failed open as NetworkError', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            const [port] = await serial.getPorts();
            source.remove(printer.id);
            expect((await rejects(port.open({ baudRate: 9600 }))).name).toBe('NetworkError');
        });

        await it('turns a failed write into NetworkError on the stream', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            const [port] = await serial.getPorts();
            await port.open({ baudRate: 9600 });
            source.connections[0].failWrites = new Error('broken pipe');
            const writer = port.writable!.getWriter();
            expect((await rejects(writer.write(bytes(1)))).name).toBe('NetworkError');
        });

        await it('errors the readable when the device ends the channel', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            const [port] = await serial.getPorts();
            await port.open({ baudRate: 9600 });
            const reader = port.readable!.getReader();
            const pending = reader.read();
            source.connections[0].end();
            expect((await rejects(pending)).name).toBe('NetworkError');
            expect(port.connected).toBe(false);
        });

        await it('says control signals are not supported', async () => {
            const serial = new Serial(new FakeSource([printer]));
            const [port] = await serial.getPorts();
            expect((await rejects(port.setSignals({ dataTerminalReady: true }))).name).toBe('NotSupportedError');
            expect((await rejects(port.getSignals())).name).toBe('NotSupportedError');
        });

        await it('hides a forgotten port from getPorts', async () => {
            const serial = new Serial(new FakeSource([printer, other]));
            const [first] = await serial.getPorts();
            await first.forget();
            expect((await serial.getPorts()).length).toBe(1);
        });
    });

    await describe('connect and disconnect events', async () => {
        await it('subscribes to the platform only once a listener exists', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            await serial.getPorts();
            expect(source.subscribed).toBe(0);
            serial.addEventListener('connect', () => undefined);
            expect(source.subscribed).toBe(1);
            serial.dispose();
            expect(source.listenerCount).toBe(0);
        });

        await it('fires disconnect on the Serial object and on the port', async () => {
            const source = new FakeSource([printer]);
            const serial = new Serial(source);
            const [port] = await serial.getPorts();
            await port.open({ baudRate: 9600 });
            let onSerial = 0;
            let onPort = 0;
            serial.addEventListener('disconnect', () => onSerial++);
            port.addEventListener('disconnect', () => onPort++);
            source.remove(printer.id);
            expect(onSerial).toBe(1);
            expect(onPort).toBe(1);
            expect(port.connected).toBe(false);
        });

        await it('fires connect when a device appears', async () => {
            const source = new FakeSource([]);
            const serial = new Serial(source);
            let connects = 0;
            serial.addEventListener('connect', () => connects++);
            source.add(printer);
            expect(connects).toBe(1);
            expect((await serial.getPorts()).length).toBe(1);
        });
    });
};
