/**
 * Utf8Array to string
 * @param array Utf-8 Array 
 * @returns The converted string
 * @credits https://stackoverflow.com/a/41798356/1465919
 * @credits https://stackoverflow.com/a/36949791/1465919
 */
export const Utf8ArrayToStr = (array: Uint8Array) => {
    return new TextDecoder().decode(array);
    // var charCache = new Array(128);  // Preallocate the cache for the common single byte chars
    // var charFromCodePt = String.fromCodePoint || String.fromCharCode;
    // var result = [];

    // return function (array: Uint8Array) {
    //     var codePt, byte1;
    //     var buffLen = array.length;

    //     result.length = 0;

    //     for (var i = 0; i < buffLen;) {
    //         byte1 = array[i++];

    //         if (byte1 <= 0x7F) {
    //             codePt = byte1;
    //         } else if (byte1 <= 0xDF) {
    //             codePt = ((byte1 & 0x1F) << 6) | (array[i++] & 0x3F);
    //         } else if (byte1 <= 0xEF) {
    //             codePt = ((byte1 & 0x0F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
    //         } else if (String.fromCodePoint) {
    //             codePt = ((byte1 & 0x07) << 18) | ((array[i++] & 0x3F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
    //         } else {
    //             codePt = 63;    // Cannot convert four byte code points, so use "?" instead
    //             i += 3;
    //         }

    //         result.push(charCache[codePt] || (charCache[codePt] = charFromCodePt(codePt)));
    //     }

    //     return result.join('');
    // }(array);
}