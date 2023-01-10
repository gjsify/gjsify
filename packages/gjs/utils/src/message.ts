// See https://github.com/denoland/deno_std/blob/44d05e7a8d445888d989d49eb3e59eee3055f2c5/node/_utils.ts#L21
export const notImplemented = (msg: string) => {
    const message = msg ? `Not implemented: ${msg}` : "Not implemented";
    throw new Error(message);
}

export const warnNotImplemented = (msg) => {
    const message = msg ? `Not implemented: ${msg}` : "Not implemented";
    console.warn(message);
    return message;
}