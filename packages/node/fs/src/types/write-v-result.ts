export interface WriteVResult {
    bytesWritten: number;
    buffers: NodeJS.ArrayBufferView[];
}