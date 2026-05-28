import { run, describe, it, expect } from '@gjsify/unit';

run({
    async DomExceptionTest() {
        await describe('DOMException', async () => {
            await describe('constructor', async () => {
                await it('should be constructable with no arguments', async () => {
                    const e = new DOMException();
                    expect(e.message).toBe('');
                    expect(e.name).toBe('Error');
                    expect(e.code).toBe(0);
                });

                await it('should be constructable with a message', async () => {
                    const e = new DOMException('test message');
                    expect(e.message).toBe('test message');
                    expect(e.name).toBe('Error');
                    expect(e.code).toBe(0);
                });

                await it('should be constructable with message and name', async () => {
                    const e = new DOMException('test message', 'NotFoundError');
                    expect(e.message).toBe('test message');
                    expect(e.name).toBe('NotFoundError');
                    expect(e.code).toBe(8);
                });
            });

            await describe('instanceof', async () => {
                await it('should be an instance of DOMException', async () => {
                    const e = new DOMException('test');
                    expect(e instanceof DOMException).toBe(true);
                });

                await it('should be an instance of Error', async () => {
                    const e = new DOMException('test');
                    expect(e instanceof Error).toBe(true);
                });
            });

            await describe('error code mapping', async () => {
                await it('IndexSizeError should have code 1', async () => {
                    const e = new DOMException('', 'IndexSizeError');
                    expect(e.code).toBe(1);
                });

                await it('HierarchyRequestError should have code 3', async () => {
                    const e = new DOMException('', 'HierarchyRequestError');
                    expect(e.code).toBe(3);
                });

                await it('NotFoundError should have code 8', async () => {
                    const e = new DOMException('', 'NotFoundError');
                    expect(e.code).toBe(8);
                });

                await it('InvalidStateError should have code 11', async () => {
                    const e = new DOMException('', 'InvalidStateError');
                    expect(e.code).toBe(11);
                });

                await it('SyntaxError should have code 12', async () => {
                    const e = new DOMException('', 'SyntaxError');
                    expect(e.code).toBe(12);
                });

                await it('SecurityError should have code 18', async () => {
                    const e = new DOMException('', 'SecurityError');
                    expect(e.code).toBe(18);
                });

                await it('NetworkError should have code 19', async () => {
                    const e = new DOMException('', 'NetworkError');
                    expect(e.code).toBe(19);
                });

                await it('AbortError should have code 20', async () => {
                    const e = new DOMException('', 'AbortError');
                    expect(e.code).toBe(20);
                });

                await it('TimeoutError should have code 23', async () => {
                    const e = new DOMException('', 'TimeoutError');
                    expect(e.code).toBe(23);
                });

                await it('DataCloneError should have code 25', async () => {
                    const e = new DOMException('', 'DataCloneError');
                    expect(e.code).toBe(25);
                });
            });

            await describe('unknown error names', async () => {
                await it('should have code 0 for unknown name', async () => {
                    const e = new DOMException('test', 'CustomError');
                    expect(e.code).toBe(0);
                    expect(e.name).toBe('CustomError');
                });
            });
        });
    },
});
