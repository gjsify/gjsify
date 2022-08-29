import { deflateSync, inflateSync, gzip, gunzip, zlibSync, unzlibSync } from 'fflate';

// TODO create a class and add missing methods, see https://nodejs.org/api/zlib.html

export const deflateRaw = deflateSync
export const inflateRaw = inflateSync
export const deflate = zlibSync
export const inflate = unzlibSync
export { gzip, gunzip }

export default {
  deflateRaw,
  inflateRaw,
  gzip,
  gunzip,
  deflate,
  inflate
}