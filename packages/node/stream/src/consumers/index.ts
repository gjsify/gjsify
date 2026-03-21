// stream/consumers — Utility functions for consuming readable streams

export async function arrayBuffer(stream: ReadableStream | AsyncIterable<any>): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<any>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk)));
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

export async function blob(stream: ReadableStream | AsyncIterable<any>): Promise<Blob> {
  const buf = await arrayBuffer(stream);
  return new Blob([buf]);
}

export async function buffer(stream: ReadableStream | AsyncIterable<any>): Promise<any> {
  const buf = await arrayBuffer(stream);
  // Return as Uint8Array (Buffer-compatible)
  return new Uint8Array(buf);
}

export async function text(stream: ReadableStream | AsyncIterable<any>): Promise<string> {
  const buf = await arrayBuffer(stream);
  return new TextDecoder().decode(buf);
}

export async function json(stream: ReadableStream | AsyncIterable<any>): Promise<any> {
  const str = await text(stream);
  return JSON.parse(str);
}

export default { arrayBuffer, blob, buffer, text, json };
