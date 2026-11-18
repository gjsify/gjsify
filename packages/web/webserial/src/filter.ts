import type { PortHandle } from './port-source.js';
import type { SerialPortFilter } from './types.js';

const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** 16-bit, 32-bit or full UUID in, canonical lower-case 128-bit UUID out. */
export function canonicalUuid(value: number | string): string {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
            throw new TypeError(`not a service class id: ${value}`);
        }
        return `${value.toString(16).padStart(8, '0')}${BASE_UUID_SUFFIX}`;
    }
    const lower = value.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) return lower;
    if (/^[0-9a-f]{4}$/.test(lower)) return `0000${lower}${BASE_UUID_SUFFIX}`;
    if (/^[0-9a-f]{8}$/.test(lower)) return `${lower}${BASE_UUID_SUFFIX}`;
    throw new TypeError(`not a service class id: ${value}`);
}

/** Reject what the spec rejects: empty filters, a product id without a vendor, mixed transports. */
export function validateFilters(filters: SerialPortFilter[] | undefined): void {
    for (const filter of filters ?? []) {
        const { usbVendorId, usbProductId, bluetoothServiceClassId } = filter;
        if (usbVendorId === undefined && usbProductId === undefined && bluetoothServiceClassId === undefined) {
            throw new TypeError('A filter must provide a property to filter by.');
        }
        if (usbProductId !== undefined && usbVendorId === undefined) {
            throw new TypeError('A filter containing a usbProductId must also contain a usbVendorId.');
        }
        if (bluetoothServiceClassId !== undefined) {
            if (usbVendorId !== undefined || usbProductId !== undefined) {
                throw new TypeError(
                    'A filter containing a bluetoothServiceClassId cannot also contain USB properties.',
                );
            }
            canonicalUuid(bluetoothServiceClassId);
        }
    }
}

function matches(handle: PortHandle, filter: SerialPortFilter): boolean {
    const { info } = handle;
    if (filter.bluetoothServiceClassId !== undefined) {
        if (info.bluetoothServiceClassId === undefined) return false;
        return canonicalUuid(info.bluetoothServiceClassId) === canonicalUuid(filter.bluetoothServiceClassId);
    }
    if (filter.usbVendorId !== undefined && info.usbVendorId !== filter.usbVendorId) return false;
    if (filter.usbProductId !== undefined && info.usbProductId !== filter.usbProductId) return false;
    return true;
}

/** No filters (or an empty list) means every port is a candidate. */
export function applyFilters(handles: PortHandle[], filters: SerialPortFilter[] | undefined): PortHandle[] {
    if (!filters || filters.length === 0) return handles;
    return handles.filter((handle) => filters.some((filter) => matches(handle, filter)));
}
