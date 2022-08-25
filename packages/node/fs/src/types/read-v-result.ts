export interface ReadVResult {
    bytesRead: number;
    buffers: NodeJS.ArrayBufferView[];
}