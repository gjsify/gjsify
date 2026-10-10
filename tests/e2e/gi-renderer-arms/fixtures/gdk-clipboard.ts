// `gi://Gdk` answered by the renderer: a string `GObject.Value` published through a
// `ContentProvider` to the display clipboard, and an absent member refused by name.
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';

export const kind = typeof Gdk.ContentProvider.new_for_value;

export async function exercise(): Promise<Record<string, unknown>> {
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string('hello');
    const provider = Gdk.ContentProvider.new_for_value(value);
    const clipboard = Gdk.Display.get_default()!.get_clipboard();
    const accepted = clipboard.set_content(provider);
    const formats = clipboard.get_formats().to_string();
    let refusal = '';
    try {
        void (Gdk as unknown as Record<string, unknown>).Texture;
    } catch (error) {
        refusal = (error as Error).message;
    }
    return {
        accepted,
        text: value.get_string(),
        offersString: formats.includes('gchararray'),
        refusesTexture: refusal.includes('Texture'),
    };
}
