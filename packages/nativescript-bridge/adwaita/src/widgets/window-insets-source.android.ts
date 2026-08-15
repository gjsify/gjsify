// Window insets on Android — the real reading, from `WindowInsetsCompat`.
//
// WHY THERE IS NO CHEAPER WAY. From API 35 an app that targets it draws edge-to-edge
// whether it asks to or not, and the APIs that used to colour the bars instead are
// deprecated AND disabled: `statusBarColor`, `navigationBarColor`,
// `setDecorFitsSystemWindows`. So content sits under the clock and under the gesture
// pill unless the app applies the insets itself. That is the whole feature (#1128).
//
// `WindowCompat.setDecorFitsSystemWindows(window, false)` is still called, and is NOT
// a contradiction of the paragraph above: what API 35 disabled is the framework
// method's ability to turn edge-to-edge OFF. Calling the COMPAT one keeps the same
// behaviour on API 24-34, where the default is still fitting — one code path for the
// whole `minSdkVersion` range instead of a version branch.
//
// `androidx.core` is not a declared dependency and does not need to be: it arrives
// with `@nativescript/android`, which is how `icons.android.ts` already reaches
// `androidx.core.graphics.PathParser`.
//
// THE LISTENER IS A SINGLETON because the platform's is: setting a second listener
// on the same view REPLACES the first, silently. An app has one window and as many
// toolbar views as it has panes, so the reading is taken once and fanned out through
// `WindowInsetsBroadcast`.

import { Application, Screen } from '@nativescript/core';

import { type WindowInsetsListener, WindowInsetsBroadcast } from './window-insets.js';

/**
 * The `androidx.core.view` surface this file uses, structurally typed and possibly
 * absent — the same shape `icons.android.ts` declares for `PathParser`. Optional so
 * every dereference has to be guarded, which is what keeps a missing runtime from
 * being a crash.
 */
declare const androidx:
    | {
          core: {
              view: {
                  ViewCompat: {
                      setOnApplyWindowInsetsListener(view: unknown, listener: unknown): void;
                  };
                  WindowCompat: {
                      setDecorFitsSystemWindows(window: unknown, decorFitsSystemWindows: boolean): void;
                  };
                  WindowInsetsCompat: {
                      Type: { systemBars(): number; displayCutout(): number };
                  };
                  OnApplyWindowInsetsListener: new (impl: {
                      onApplyWindowInsets(view: unknown, insets: AndroidWindowInsetsCompat): AndroidWindowInsetsCompat;
                  }) => unknown;
              };
          };
      }
    | undefined;

/** The `WindowInsetsCompat` instance handed to the listener. */
interface AndroidWindowInsetsCompat {
    getInsets(typeMask: number): { top: number; bottom: number; left: number; right: number };
}

const broadcast = new WindowInsetsBroadcast();
let installed = false;

/** Physical pixels → device-independent pixels, which is what NS `padding` speaks. */
function toDips(px: number): number {
    const scale = Screen.mainScreen?.scale ?? 1;
    return scale > 0 ? px / scale : px;
}

/**
 * Install the platform listener once.
 *
 * Every failure is a silent zero rather than a throw: this runs from a widget's
 * `loaded`, and an app that cannot read its insets should sit under the status bar,
 * not fail to start. The condition is observable — insets stay at zero — and the
 * decor view is the one place both edges' insets are dispatched.
 */
function install(): void {
    if (installed) return;
    const view = androidx?.core?.view;
    if (!view) return;

    const activity = Application.android?.foregroundActivity ?? Application.android?.startActivity;
    const window = activity?.getWindow?.();
    const decor = window?.getDecorView?.();
    if (!window || !decor) return;

    installed = true;
    view.WindowCompat.setDecorFitsSystemWindows(window, false);

    const mask = view.WindowInsetsCompat.Type.systemBars() | view.WindowInsetsCompat.Type.displayCutout();
    view.ViewCompat.setOnApplyWindowInsetsListener(
        decor,
        new view.OnApplyWindowInsetsListener({
            onApplyWindowInsets(_v: unknown, insets: AndroidWindowInsetsCompat) {
                const bars = insets.getInsets(mask);
                broadcast.publish({
                    top: toDips(bars.top),
                    bottom: toDips(bars.bottom),
                    left: toDips(bars.left),
                    right: toDips(bars.right),
                });
                // Returned UNCONSUMED: the insets keep travelling down the tree, so
                // anything else that reads them (a keyboard-aware scroll view) still
                // sees them. Consuming here would make this the only reader.
                return insets;
            },
        }),
    );
}

/** Subscribe to window-inset changes. Returns the unsubscribe. */
export function observeWindowInsets(listener: WindowInsetsListener): () => void {
    install();
    return broadcast.subscribe(listener);
}
