/** What `SerialPort.getInfo()` reports. Bluetooth ports carry the service class they were found by. */
export interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
    bluetoothServiceClassId?: number | string;
}

export interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
    bluetoothServiceClassId?: number | string;
}

export interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
    /**
     * Accepted and ignored: on this backend every bonded device that advertises a matching service
     * class is already known, so there is nothing further to unlock.
     */
    allowedBluetoothServiceClassIds?: Array<number | string>;
}

export interface SerialOptions {
    /** Required by the spec. A Bluetooth serial port has no baud rate, so the value is not used. */
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
}
