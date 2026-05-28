// Reference: Node.js lib/cluster.js — stub for GJS

import { EventEmitter } from 'node:events';

export const isPrimary = true;
export const isMaster = true;
export const isWorker = false;
export const workers: Record<number, unknown> = {};
export const settings: Record<string, unknown> = {};

export function setupPrimary(_settings?: Record<string, unknown>): void {}

export const setupMaster = setupPrimary;

export function fork(_env?: Record<string, string | undefined>): never {
    throw new Error('cluster.fork() is not supported in GJS');
}

export function disconnect(_callback?: () => void): void {}

export const schedulingPolicy = 2; // SCHED_RR
export const SCHED_NONE = 1;
export const SCHED_RR = 2;

class ClusterEmitter extends EventEmitter {}

const cluster = new ClusterEmitter();

Object.assign(cluster, {
    isPrimary,
    isMaster,
    isWorker,
    workers,
    settings,
    setupPrimary,
    setupMaster,
    fork,
    disconnect,
    schedulingPolicy,
    SCHED_NONE,
    SCHED_RR,
});

export default cluster;
