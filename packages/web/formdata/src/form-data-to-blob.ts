/**
 * Serialize FormData to a multipart/form-data Blob.
 *
 * This is the equivalent of formdata-polyfill's formDataToBlob().
 * Used by the Body mixin to convert FormData bodies for transmission.
 */

import type { FormData } from './formdata.ts';
import { File } from './file.ts';

function generateBoundary(): string {
    let boundary = '----formdata-';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 24; i++) {
        boundary += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return boundary;
}

function escape(str: string): string {
    return str.replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/"/g, '%22');
}

/**
 * Converts a FormData instance into a Blob with multipart/form-data content type.
 */
export function formDataToBlob(formData: FormData, boundary?: string): Blob {
    boundary = boundary ?? generateBoundary();
    const chunks: BlobPart[] = [];
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="`;

    for (const [name, value] of formData.entries()) {
        if (typeof value === 'string') {
            chunks.push(
                `${prefix}${escape(name)}"\r\n\r\n${value.replace(/\r(?!\n)|(?<!\r)\n/g, '\r\n')}\r\n`
            );
        } else {
            // File or Blob
            const file = value instanceof File
                ? value
                : new File([value as Blob], 'blob', { type: (value as Blob).type });

            chunks.push(
                `${prefix}${escape(name)}"; filename="${escape(file.name)}"\r\n` +
                `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
            );
            chunks.push(file);
            chunks.push('\r\n');
        }
    }

    chunks.push(`--${boundary}--`);

    return new Blob(chunks, {
        type: `multipart/form-data; boundary=${boundary}`,
    });
}
