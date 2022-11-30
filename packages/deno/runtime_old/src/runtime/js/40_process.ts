// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// https://github.com/denoland/deno/blob/main/runtime/js/40_process.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { readAll } from './12_io.js';
import { pathFromURL } from './06_util.js';
import { FsFile } from './40_files.js';
import { assert } from '../../ext/web/00_infra.js';

import type { Signal } from '../../types/index.js';

const {
  ArrayPrototypeMap,
  ArrayPrototypeSlice,
  TypeError,
  ObjectEntries,
  String,
} = primordials;

function opKill(pid: number, signo: Signal, apiName: string) {
  ops.op_kill(pid, signo, apiName);
}

export function kill(pid: number, signo: Signal = "SIGTERM") {
  opKill(pid, signo, "Deno.kill()");
}

function opRunStatus(rid: number) {
  return core.opAsync("op_run_status", rid);
}

function opRun(request) {
  assert(request.cmd.length > 0);
  return ops.op_run(request);
}

async function runStatus(rid) {
  const res = await opRunStatus(rid);

  if (res.gotSignal) {
    const signal = res.exitSignal;
    return { success: false, code: 128 + signal, signal };
  } else if (res.exitCode != 0) {
    return { success: false, code: res.exitCode };
  } else {
    return { success: true, code: 0 };
  }
}

export class Process {
  rid: number;
  pid: number;
  stdin: FsFile;
  stdout: FsFile;
  stderr: FsFile;
  constructor(res) {
    this.rid = res.rid;
    this.pid = res.pid;

    if (res.stdinRid && res.stdinRid > 0) {
      this.stdin = new FsFile(res.stdinRid);
    }

    if (res.stdoutRid && res.stdoutRid > 0) {
      this.stdout = new FsFile(res.stdoutRid);
    }

    if (res.stderrRid && res.stderrRid > 0) {
      this.stderr = new FsFile(res.stderrRid);
    }
  }

  status() {
    return runStatus(this.rid);
  }

  async output() {
    if (!this.stdout) {
      throw new TypeError("stdout was not piped");
    }
    try {
      return await readAll(this.stdout);
    } finally {
      this.stdout.close();
    }
  }

  async stderrOutput() {
    if (!this.stderr) {
      throw new TypeError("stderr was not piped");
    }
    try {
      return await readAll(this.stderr);
    } finally {
      this.stderr.close();
    }
  }

  close() {
    core.close(this.rid);
  }

  kill(signo: Signal = "SIGTERM") {
    opKill(this.pid, signo, "Deno.Process.kill()");
  }
}

export function run({
  cmd,
  cwd = undefined,
  clearEnv = false,
  env = {},
  gid = undefined,
  uid = undefined,
  stdout = "inherit",
  stderr = "inherit",
  stdin = "inherit",
}) {
  if (cmd[0] != null) {
    cmd = [pathFromURL(cmd[0]), ...ArrayPrototypeSlice(cmd, 1)];
  }
  const res = opRun({
    cmd: ArrayPrototypeMap(cmd, String),
    cwd,
    clearEnv,
    env: ObjectEntries(env),
    gid,
    uid,
    stdin,
    stdout,
    stderr,
  });
  return new Process(res);
}
