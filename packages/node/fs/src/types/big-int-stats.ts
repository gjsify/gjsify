import type { StatsBase } from './index.js';

export interface BigIntStats extends StatsBase<bigint> {
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
}