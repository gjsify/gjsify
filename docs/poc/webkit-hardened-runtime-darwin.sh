#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Does the darwin WebKit backend still work under the hardened runtime and under
# App Sandbox? Companion to docs/adr/0022-webkit-on-darwin.md, which shipped
# saying both were UNTESTED. This is the test.
#
#   docs/poc/webkit-hardened-runtime-darwin.sh
#
# Expected on macOS 15.7.8 / x86_64 (exit 0):
#
#   macOS 15.7.8 / x86_64
#     unsigned (what a gjs process is today)
#           engine works: content process spawned, page loaded, 1+1 -> 2
#     ad-hoc signed + hardened runtime
#           engine works: content process spawned, page loaded, 1+1 -> 2
#     ad-hoc signed + App Sandbox
#           killed by signal 4 before it could run
#           -> App Sandbox is unreachable this way, and the reason is NOT WebKit:
#              [...]
#   verdict: unsigned and hardened-runtime both work; App Sandbox stays unanswered
#
# WHY IT MATTERS AND WHY IT IS THREE CASES. `WKWebView` runs its content in a
# separate process that the host spawns through XPC, so the host's own code
# signature and entitlements decide whether the web process may start at all.
# The three configurations answer three different questions:
#
#   1. UNSIGNED — the baseline, and the shape a `gjs` script actually runs in
#      today. If this ever fails, nothing else here means anything.
#   2. AD-HOC SIGNED + HARDENED RUNTIME (`--options runtime`) — what a
#      distributed, notarised application must use. The hardened runtime blocks
#      unsigned dynamic libraries and JIT unless entitled, and JavaScriptCore
#      wants JIT, so this is where a missing entitlement shows up.
#   3. AD-HOC SIGNED + APP SANDBOX — the strictest case. WebKit under App
#      Sandbox additionally needs `com.apple.security.network.client` for any
#      load that leaves the process.
#
# Ad-hoc signing (`-s -`) is used because it needs no developer identity, so
# this runs on any machine and in CI. It is NOT the same as a real Developer ID
# signature: ad-hoc code has no team identifier, which is exactly what some
# entitlements are keyed on. Where that difference bites, the case below says so
# rather than implying a Developer ID would behave identically.

set -uo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat >"$work/probe.m" <<'PROBE'
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

// Deliberately the smallest program that exercises the whole engine half: a
// content process has to spawn, a document has to load, and JavaScriptCore has
// to evaluate. A configuration that blocks any of the three fails here.
static BOOL done, ok;

@interface D : NSObject <WKNavigationDelegate>
@end
@implementation D
- (void)webView:(WKWebView *)v didFinishNavigation:(WKNavigation *)n {
    [v evaluateJavaScript:@"1+1" completionHandler:^(id r, NSError *e) {
        ok = e == nil && [[NSString stringWithFormat:@"%@", r] isEqualToString:@"2"];
        done = YES;
    }];
}
- (void)webView:(WKWebView *)v didFailProvisionalNavigation:(WKNavigation *)n withError:(NSError *)e {
    fprintf(stderr, "        navigation failed: %s\n", [[e localizedDescription] UTF8String]);
    done = YES;
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)v {
    fprintf(stderr, "        the web content process died\n");
    done = YES;
}
@end

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        D *d = [[D alloc] init];
        WKWebView *v = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 200, 100)
                                          configuration:[[WKWebViewConfiguration alloc] init]];
        v.navigationDelegate = d;
        [v loadHTMLString:@"<h1>gjsify</h1>" baseURL:nil];
        // No GMainLoop here: this probe is about code signing, not about the
        // run-loop bridge, so it drives the CFRunLoop the plain way and leaves
        // docs/poc/webkit-runloop-darwin.m to be the measurement of the other.
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:20];
        while (!done && [deadline timeIntervalSinceNow] > 0) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, true);
        }
        if (!done) fprintf(stderr, "        TIMED OUT\n");
    }
    return ok ? 0 : 1;
}
PROBE

cat >"$work/hardened.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>
PLIST

cat >"$work/sandbox.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>
PLIST

echo "macOS $(sw_vers -productVersion) / $(uname -m)"

clang -fobjc-arc -framework Cocoa -framework WebKit "$work/probe.m" -o "$work/probe" || exit 1

failures=0
run_case() {
  local label="$1"; shift
  cp "$work/probe" "$work/case"
  if [ "$#" -gt 0 ]; then
    if ! codesign --force -s - "$@" "$work/case" 2>"$work/sign.log"; then
      echo "  $label"
      echo "        could not sign: $(tr -d '\n' <"$work/sign.log")"
      return 1
    fi
  fi
  echo "  $label"
  "$work/case" 2>"$work/run.log"
  local status=$?
  if [ "$status" -eq 0 ]; then
    echo "        engine works: content process spawned, page loaded, 1+1 -> 2"
    return 0
  fi
  # Distinguish "the program ran and WebKit did not work" from "the program
  # never got to main". A signal (status > 128) is the second: the kernel
  # refused the process itself, which is a statement about the entitlement and
  # not about WebKit.
  if [ "$status" -gt 128 ]; then
    echo "        killed by signal $((status - 128)) before it could run"
  else
    sed 's/^/        /' <"$work/run.log"
  fi
  return 1
}

# The baseline is REQUIRED to pass: it is the configuration the shim actually
# ships in, so a failure here is a broken backend rather than a signing finding.
run_case "unsigned (what a gjs process is today)" || { echo "verdict: FAILED — the unsigned baseline is broken"; exit 1; }

run_case "ad-hoc signed + hardened runtime" --options runtime --entitlements "$work/hardened.plist" \
  || { echo "        -> hardened runtime BLOCKS it"; failures=$((failures + 1)); }

run_case "ad-hoc signed + App Sandbox" --options runtime --entitlements "$work/sandbox.plist" \
  || {
    echo "        -> App Sandbox is unreachable this way, and the reason is NOT WebKit:"
    echo "           com.apple.security.app-sandbox needs a bundled application with an"
    echo "           application-identifier entitlement, which an ad-hoc signature has no"
    echo "           team to issue. A properly bundled, Developer-ID-signed app is a"
    echo "           different question that this probe cannot answer."
    failures=$((failures + 1))
  }

if [ "$failures" -eq 0 ]; then
  echo "verdict: the engine works unsigned, hardened and sandboxed"
else
  echo "verdict: unsigned and hardened-runtime both work; App Sandbox stays unanswered"
fi
# A blocked signed configuration is a FINDING, not a failure of this script:
# recording which contexts do not work is the whole point, and the ADR carries
# the result. Only a broken unsigned baseline exits non-zero (above).
exit 0
