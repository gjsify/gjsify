// @gjsify/webassembly — WebAssembly Promise-API polyfill for GJS.
//
// Reference: WebAssembly JS API (https://webassembly.github.io/spec/js-api/)
// Reimplemented for GJS using SpiderMonkey 128+'s synchronous WebAssembly.{Module,Instance}.
//
// SpiderMonkey 128 (GJS 1.86) ships:
//   - WebAssembly global object                 ✓
//   - new WebAssembly.Module(buffer)            ✓ synchronous compile
//   - new WebAssembly.Instance(module, imports) ✓ synchronous instantiate
//   - WebAssembly.{compile,compileStreaming,instantiate,instantiateStreaming,validate}
//                                               ✗ exist as functions but throw
//                                                 "WebAssembly Promise APIs not supported in this runtime."
//
// This package wraps the synchronous constructors with Promise.{resolve,reject} so
// the missing Promise APIs become trivially available. The streaming variants
// fetch the bytes via Response.arrayBuffer() and pipe through the same wrappers.

const NATIVE_WEBASSEMBLY = (globalThis as any).WebAssembly;

if (typeof NATIVE_WEBASSEMBLY === 'undefined') {
    throw new Error('@gjsify/webassembly: globalThis.WebAssembly is not defined; nothing to polyfill.');
}

type WAModule = typeof globalThis.WebAssembly.Module.prototype;
type WAInstance = typeof globalThis.WebAssembly.Instance.prototype;

export interface WebAssemblyModuleConstructor {
    new (buffer: BufferSource): WAModule;
}
export interface WebAssemblyInstanceConstructor {
    new (module: WAModule, importObject?: WebAssembly.Imports): WAInstance;
}

const Module = NATIVE_WEBASSEMBLY.Module as WebAssemblyModuleConstructor;
const Instance = NATIVE_WEBASSEMBLY.Instance as WebAssemblyInstanceConstructor;

/** Polyfill for `WebAssembly.compile()`. */
export function compile(buffer: BufferSource): Promise<WAModule> {
    try {
        return Promise.resolve(new Module(buffer));
    } catch (err) {
        return Promise.reject(err);
    }
}

/** Polyfill for `WebAssembly.validate()`. */
export function validate(buffer: BufferSource): boolean {
    try {
        new Module(buffer);
        return true;
    } catch {
        return false;
    }
}

/** Polyfill for `WebAssembly.instantiate()`. Two overloads:
 *   - bytes  → { module, instance }
 *   - module → instance
 */
export function instantiate(
    bytes: BufferSource,
    importObject?: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource>;
export function instantiate(
    module: WAModule,
    importObject?: WebAssembly.Imports,
): Promise<WAInstance>;
export function instantiate(
    bytesOrModule: BufferSource | WAModule,
    importObject?: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource | WAInstance> {
    try {
        if (bytesOrModule instanceof Module) {
            return Promise.resolve(new Instance(bytesOrModule as WAModule, importObject));
        }
        const module = new Module(bytesOrModule as BufferSource);
        const instance = new Instance(module, importObject);
        return Promise.resolve({ module, instance });
    } catch (err) {
        return Promise.reject(err);
    }
}

async function bufferFromSource(source: Response | PromiseLike<Response>): Promise<ArrayBuffer> {
    const response = await source;
    return response.arrayBuffer();
}

/** Polyfill for `WebAssembly.compileStreaming()`. */
export async function compileStreaming(
    source: Response | PromiseLike<Response>,
): Promise<WAModule> {
    const buffer = await bufferFromSource(source);
    return compile(buffer);
}

/** Polyfill for `WebAssembly.instantiateStreaming()`. */
export async function instantiateStreaming(
    source: Response | PromiseLike<Response>,
    importObject?: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    const buffer = await bufferFromSource(source);
    return instantiate(buffer, importObject) as Promise<WebAssembly.WebAssemblyInstantiatedSource>;
}

export default { compile, compileStreaming, instantiate, instantiateStreaming, validate };
