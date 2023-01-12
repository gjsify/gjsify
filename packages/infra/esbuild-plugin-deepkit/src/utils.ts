/**
 * Utf8Array to string
 * @param array Utf-8 Array 
 * @returns The converted string
 * @credits https://stackoverflow.com/a/41798356/1465919
 * @credits https://stackoverflow.com/a/36949791/1465919
 */
export const Utf8ArrayToStr = (array: Uint8Array) => {
    return new TextDecoder().decode(array);
}