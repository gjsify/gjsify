/* ADR 0141 § Test, in the one language that can send the selector.
 *
 * 1. A real GtkApplicationQuartzDelegate instance, selector sent with
 *    hasVisibleWindows NO -> GApplication::activate fires; YES -> it does not.
 * 2. A stand-in class that already implements the selector is left untouched.
 */
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <objc/message.h>
#include <gio/gio.h>
#include <gtk/gtk.h>

gboolean gjsify_quartz_install_reopen_handler (void);
gboolean gjsify_quartz_install_reopen_handler_for_class (const char *class_name);

#define CHECK(cond) do { if (!(cond)) { fprintf (stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); return 1; } } while (0)

static int activations = 0;
static void on_activate (GApplication *app, gpointer data) { (void) app; (void) data; activations++; }

static int stand_in_calls = 0;
static BOOL stand_in_imp (id self, SEL cmd, id sender, BOOL visible) { (void) self; (void) cmd; (void) sender; (void) visible; stand_in_calls++; return NO; }

typedef BOOL (*reopen_fn) (id, SEL, id, BOOL);

int main (void)
{
    /* Referencing GTK forces the dylib (and its ObjC classes) to load. */
    if (gtk_get_major_version () != 4) return 2;
    SEL sel = sel_registerName ("applicationShouldHandleReopen:hasVisibleWindows:");
    Class gtk_delegate = objc_getClass ("GtkApplicationQuartzDelegate");
    CHECK (gtk_delegate != Nil);

    gboolean gtk_has_it = class_respondsToSelector (gtk_delegate, sel);
    GApplication *app = g_application_new ("org.gjsify.QuartzTest", G_APPLICATION_NON_UNIQUE);
    g_signal_connect (app, "activate", G_CALLBACK (on_activate), NULL);
    CHECK (g_application_get_default () == app);
    CHECK (g_application_register (app, NULL, NULL));

    gboolean installed = gjsify_quartz_install_reopen_handler ();
    CHECK (installed == !gtk_has_it);                       /* self-retirement */
    CHECK (class_respondsToSelector (gtk_delegate, sel));
    CHECK (gjsify_quartz_install_reopen_handler () == FALSE); /* second add is a no-op */

    id delegate = class_createInstance (gtk_delegate, 0);
    reopen_fn send = (reopen_fn) objc_msgSend;
    if (!gtk_has_it) {
        CHECK (send (delegate, sel, nil, YES) == YES);
        CHECK (activations == 0);
        CHECK (send (delegate, sel, nil, NO) == YES);
        CHECK (activations == 1);
    } else {
        fprintf (stderr, "NOTE: bundled GTK already implements the selector; bridge is retired\n");
    }

    Class stand_in = objc_allocateClassPair ([NSObject class], "GjsifyQuartzStandIn", 0);
    CHECK (class_addMethod (stand_in, sel, (IMP) stand_in_imp,
                          sizeof (BOOL) == 1 && (BOOL) 2 == 1 ? "B@:@B" : "c@:@c"));
    objc_registerClassPair (stand_in);
    IMP before = class_getMethodImplementation (stand_in, sel);
    CHECK (gjsify_quartz_install_reopen_handler_for_class ("GjsifyQuartzStandIn") == FALSE);
    CHECK (class_getMethodImplementation (stand_in, sel) == before);
    id other = class_createInstance (stand_in, 0);
    int seen = activations;
    CHECK (send (other, sel, nil, NO) == NO);
    CHECK (stand_in_calls == 1 && activations == seen);

    CHECK (gjsify_quartz_install_reopen_handler_for_class ("NoSuchClassAnywhere") == FALSE);
    printf ("reopen-handler: ok (gtk_had_it=%d)\n", gtk_has_it);
    return 0;
}
