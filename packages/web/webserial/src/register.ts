// Web Serial API — global registration for GJS.
// Sets `navigator.serial` (backed by BlueZ RFCOMM) and the `Serial`/`SerialPort` constructors.
// Side-effect module: import '@gjsify/webserial/register'

import '@gjsify/node-globals/register/navigator';

import { BluezRfcommSource } from './bluez-rfcomm-source.js';
import { Serial } from './serial.js';
import { SerialPort } from './serial-port.js';

/** Module-local typed view of the globals this file writes. */
interface _SerialGlobals {
    navigator?: { serial?: Serial };
    Serial?: typeof Serial;
    SerialPort?: typeof SerialPort;
}

const g = globalThis as unknown as _SerialGlobals;

// Never over a runtime that has its own: a browser's Web Serial is the platform's.
// The source opens nothing until the first call, so registering costs no D-Bus traffic.
if (typeof g.navigator!.serial === 'undefined') {
    g.navigator!.serial = new Serial(new BluezRfcommSource());
}
if (typeof g.Serial === 'undefined') {
    g.Serial = Serial;
}
if (typeof g.SerialPort === 'undefined') {
    g.SerialPort = SerialPort;
}
