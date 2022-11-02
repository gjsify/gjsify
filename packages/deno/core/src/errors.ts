export class PermissionDenied extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        if (message) {
            message = `PermissionDenied: ${message}`;
        } else {
            message = 'PermissionDenied';
        }
        super(message, options);
    }
}