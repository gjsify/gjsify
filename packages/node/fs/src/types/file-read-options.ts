export interface FileReadOptions<T extends NodeJS.ArrayBufferView = Buffer> {
    /**
     * @default `Buffer.alloc(0xffff)`
     */
    buffer?: T;
    /**
     * @default 0
     */
    offset?: number | null;
    /**
     * @default `buffer.byteLength`
     */
    length?: number | null;
    position?: number | null;
}
