export interface FileReadResult<T extends NodeJS.ArrayBufferView> {
    bytesRead: number;
    buffer: T;
}