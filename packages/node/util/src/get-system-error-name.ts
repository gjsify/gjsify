import {  } from '@gjsify/node-internal';

/**
 * Returns a system error name from an error code number.
 * @param code error code number
 */
 export function getSystemErrorName(code: number): string | undefined {
    if (typeof code !== "number") {
      throw new codes.ERR_INVALID_ARG_TYPE("err", "number", code);
    }
    if (code >= 0 || !NumberIsSafeInteger(code)) {
      throw new codes.ERR_OUT_OF_RANGE("err", "a negative integer", code);
    }
    return errorMap.get(code)?.[0];
  }
  