/* SPDX-License-Identifier: MIT
 *
 * GjsifyQuartz — a Dock click reopens the application on macOS (ADR 0141).
 *
 * Pure C on purpose: g-ir-scanner has no Objective-C front end, so everything
 * that must reach the GIR lives in this header and the .m stays private.
 */

#ifndef GJSIFY_QUARTZ_H
#define GJSIFY_QUARTZ_H

#include <glib.h>

G_BEGIN_DECLS

/**
 * gjsify_quartz_install_reopen_handler:
 *
 * Teach GTK's `GtkApplicationQuartzDelegate` to answer a Dock click on a
 * running application that has no visible window. The handler emits
 * `GApplication::activate` on the default application; with visible windows it
 * does nothing, as Cocoa does by default.
 *
 * The call is self-retiring: when the loaded GTK already implements
 * `applicationShouldHandleReopen:hasVisibleWindows:` nothing is installed.
 *
 * Returns: %TRUE if this call installed the handler, %FALSE if GTK is not
 *   loaded, the delegate class is absent, or it already responds to the
 *   selector (including a previous call of this function).
 */
gboolean gjsify_quartz_install_reopen_handler (void);

G_END_DECLS

#endif
