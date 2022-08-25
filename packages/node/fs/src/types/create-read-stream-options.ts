export interface CreateReadStreamOptions {
    encoding?: BufferEncoding | null | undefined;
    autoClose?: boolean | undefined;
    emitClose?: boolean | undefined;
    start?: number | undefined;
    end?: number | undefined;
    highWaterMark?: number | undefined;
    fs?: any; // TODO
    fd?: any; // TODO
}