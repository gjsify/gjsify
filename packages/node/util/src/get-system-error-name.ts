import { codes, errorMap } from '@gjsify/node-internal';

/**
 * Returns a system error name from an error code number.
 * @param code error code number
 */
 export function getSystemErrorName(code: number): string | undefined {
    if (typeof code !== "number") {
      throw new codes.ERR_INVALID_ARG_TYPE("err", "number", code);
    }
    if (code >= 0 || !Number.isSafeInteger(code)) {
      throw new codes.ERR_OUT_OF_RANGE("err", "a negative integer", code);
    }
    const result = errorMap.get(code)?.[0];
    if(!result) {
      return `Unknown system error ${code}`
    }
    return result;
  }
  