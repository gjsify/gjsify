using Gtk;
using Gwebgl;

int main (string[] argv) {
    WebGLRenderingContext? gl = null;
    // Create a new application
    var app = new Gtk.Application ("gjsify.web.webgl.valaapp", GLib.ApplicationFlags.FLAGS_NONE);
    app.activate.connect (() => {
        var win = new Gtk.ApplicationWindow (app);
        win.set_default_size(800, 600);
        var glarea = new Gtk.GLArea ();
        glarea.set_use_es(true);
        glarea.set_required_version(3, 2);

        glarea.realize.connect((widget) => {
            print("\nrealize");
            glarea.make_current ();

            var error = glarea.get_error ();
            if(error != null) {
                printerr (error.message);
                return;
            }
        });

        glarea.render.connect((context) => {
            print("\nrender");

            var error = glarea.get_error ();
            if(error != null) {
                printerr (error.message);
                return false;
            }

            if(gl == null) {
                int width = glarea.get_width ();
                int height = glarea.get_height ();
                gl = new Gwebgl.WebGLRenderingContext (width, height, true, true, false, false, true, false, false, false);
            }
            // Set clear color to black, fully opaque
            gl.clearColor((float) 1.0, (float) 0.0, (float) 0.0, (float) 1.0);

            // GL.glClearColor((GL.GLfloat) 0.0, (GL.GLfloat) 0.0, (GL.GLfloat) 0.0, (GL.GLfloat) 1.0);

            // Clear the color buffer with specified clear color
            var COLOR_BUFFER_BIT = gl.get_webgl_constants().get ("COLOR_BUFFER_BIT");
            gl.clear(COLOR_BUFFER_BIT);
            // GL.glClear(GL.GL_COLOR_BUFFER_BIT);
            print("GL.GL_COLOR_BUFFER_BIT %i", GL.GL_COLOR_BUFFER_BIT);
            print("COLOR_BUFFER_BIT %i", COLOR_BUFFER_BIT);
            return true;
        });

        win.set_child (glarea);
        win.present ();
    });

    app.run (argv);
    return 0;
}