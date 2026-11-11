// @gjsify/store — programming errors in store configuration.

/** Thrown for configuration mistakes such as an unknown product id or an invalid catalog entry. */
export class StoreConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoreConfigError';
    }
}
