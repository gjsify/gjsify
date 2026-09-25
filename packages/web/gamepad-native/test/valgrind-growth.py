#!/usr/bin/env python3
"""The Linux leak check: monitor-lifecycle under valgrind memcheck, twice.

  1. No block may be definitely, indirectly or possibly lost — memory the shim
     dropped its last pointer to.
  2. What stays REACHABLE at exit must not grow with the number of start/stop
     cycles. Most of what this library could leak is reachable from a static:
     SDL's global state, a GSource left on the main context. valgrind rightly
     calls that "still reachable", and GLib's type system plus libdbus's bus
     cache (SDL opens D-Bus on init) keep a constant baseline there anyway. So
     the check is the DIFFERENCE between 1 cycle and 20: a per-cycle leak
     scales with the count, the baseline does not.

    valgrind-growth.py <valgrind> <monitor-lifecycle> [<suppressions>...]
"""
import os
import re
import subprocess
import sys

SUMMARY = re.compile(r"(definitely lost|indirectly lost|possibly lost|still reachable):\s+([\d,]+) bytes in ([\d,]+) blocks")


def run(valgrind, binary, supps, cycles):
    env = dict(os.environ, GJSIFY_GAMEPAD_CYCLES=str(cycles))
    args = [valgrind, "--leak-check=full", "--show-leak-kinds=definite,indirect,possible", "--num-callers=30"]
    args += [f"--suppressions={s}" for s in supps] + [binary]
    proc = subprocess.run(args, env=env, capture_output=True, text=True)
    kinds = {kind: (int(b.replace(",", "")), int(n.replace(",", ""))) for kind, b, n in SUMMARY.findall(proc.stderr)}
    return proc, kinds


def main(valgrind, binary, *supps):
    results = {}
    for cycles in (1, 20):
        proc, kinds = run(valgrind, binary, supps, cycles)
        if proc.returncode != 0:
            sys.stderr.write(proc.stdout + proc.stderr)
            print(f"FAIL: monitor-lifecycle exited {proc.returncode} under valgrind ({cycles} cycle(s))")
            return 1
        if "still reachable" not in kinds:
            # No summary at all means valgrind's output moved or the run was not
            # checked — never a pass.
            sys.stderr.write(proc.stderr[-4000:])
            print("FAIL: no LEAK SUMMARY in valgrind's output")
            return 1
        results[cycles] = kinds
        print(f"{cycles:>2} cycle(s): " + ", ".join(f"{k} {b} B/{n}" for k, (b, n) in kinds.items()))
        lost = {k: v for k, v in kinds.items() if k != "still reachable" and v[0] > 0}
        if lost:
            sys.stderr.write(proc.stderr[-8000:])
            print(f"FAIL: {lost}")
            return 1

    grew = results[20]["still reachable"][1] - results[1]["still reachable"][1]
    print(f"reachable blocks, 20 cycles minus 1: {grew:+d}")
    if grew > 0:
        print("FAIL: reachable memory grows with the cycle count — something survives close()")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
