/* SPDX-License-Identifier: MIT
 *
 * GjsifyQuartz — see docs/adr/0141-a-dock-click-reopens-the-application-on-macos.md.
 *
 * GTK 4.24.1's GtkApplicationQuartzDelegate does not implement
 * applicationShouldHandleReopen:hasVisibleWindows:, so a Dock click on a
 * windowless app is dropped (fixed upstream on main, in no release). The method
 * is added through the ObjC runtime; class_addMethod fails when the class
 * already has it, which is the self-retirement.
 */

#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <gio/gio.h>
#include "gjsify-quartz.h"

/* BOOL is `B` (bool) on arm64 and `c` (signed char) on x86_64. */
#if defined(__arm64__)
#define GJSIFY_QUARTZ_REOPEN_TYPES "B@:@B"
#else
#define GJSIFY_QUARTZ_REOPEN_TYPES "c@:@c"
#endif

/* Not in gjsify-quartz.h: the GIR exposes only the public entry point. Kept
 * exported so the test can aim the same logic at a stand-in class. */
gboolean gjsify_quartz_install_reopen_handler_for_class (const char *class_name);

static BOOL
gjsify_quartz_should_handle_reopen (id self, SEL cmd, id sender, BOOL has_visible_windows)
{
    (void) self; (void) cmd; (void) sender;
    if (!has_visible_windows) {
        GApplication *app = g_application_get_default ();
        if (app != NULL)
            g_application_activate (app);
    }
    /* YES: AppKit must not also try to open an untitled document. */
    return YES;
}

gboolean
gjsify_quartz_install_reopen_handler_for_class (const char *class_name)
{
    Class cls = objc_getClass (class_name);
    if (cls == Nil)
        return FALSE;

    SEL selector = sel_registerName ("applicationShouldHandleReopen:hasVisibleWindows:");
    if (class_respondsToSelector (cls, selector))
        return FALSE;

    return class_addMethod (cls, selector, (IMP) gjsify_quartz_should_handle_reopen,
                            GJSIFY_QUARTZ_REOPEN_TYPES) ? TRUE : FALSE;
}

gboolean
gjsify_quartz_install_reopen_handler (void)
{
    return gjsify_quartz_install_reopen_handler_for_class ("GtkApplicationQuartzDelegate");
}
