/**
 * Re-exports native FormData/File globals for use in Node.js builds.
 * On Node.js 21+, FormData and File are native globals.
 */
export const FormData = globalThis.FormData;
export const File = globalThis.File;
export function formDataToBlob(formData) {
  // Use native FormData — formDataToBlob is a @gjsify/formdata utility,
  // not a Web standard. Return a Blob from the native FormData entries.
  const boundary = '----FormDataBoundary' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    } else {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.name}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`);
      parts.push(value);
      parts.push('\r\n');
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return new Blob(parts, { type: `multipart/form-data; boundary=${boundary}` });
}
