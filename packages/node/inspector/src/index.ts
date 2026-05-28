// Reference: Node.js lib/inspector.js — stub for GJS

export function open(_port?: number, _host?: string, _wait?: boolean): void {}

export function close(): void {}

export function url(): string | undefined {
    return undefined;
}

export function waitForDebugger(): void {}

export class Session {
    connect(): void {}

    connectToMainThread(): void {}

    disconnect(): void {}

    // oxlint-disable-next-line typescript/no-explicit-any -- node:inspector Session.post signature: params and result are protocol-defined arbitrary objects per @types/node.
    post(_method: string, _params?: any, _callback?: (err: Error | null, result?: any) => void): void {
        if (_callback) _callback(null);
    }

    on(_event: string, _listener: Function): this {
        return this;
    }
}

const _console = { ...globalThis.console };

export { _console as console };

export default { open, close, url, waitForDebugger, Session, console: _console };
