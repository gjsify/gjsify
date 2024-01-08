import OpenAI from 'npm:openai';
import { load as loadEnv } from "https://deno.land/std/dotenv/mod.ts";

import { OpSource, OpMethod, OpenAIResponse } from './types.ts';

const env = await loadEnv();

const OPENAI_API_KEY = env['OPENAI_API_KEY'];

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const SYSTEM_PROMPT = "You are an assistant who helps me reimplement the runtime and core of Deno, which is programmed in Rust, into TypeScript using GJS (GNOME JavaScript). For this, you are well-versed in the GNOME ecosystem and familiar with the existing libraries, and you know which of these libraries might be useful right now. You understand that these can be used with GJS thanks to GObject introspection. This includes, among others: atk, atspi-2, cairo, clutter-1.0, clutter-gst-3.0, clutter-gtk-1.0, cogl-1.0, cogl-pango-1.0, gdk-3.0, gdk-pixbuf-2.0, gdk-x11-3.0, gegl-0.4, gegl-gtk3-0.1, gio-2.0, gio-unix-2.0, glib-2.0, gmime-3.0, gmodule-2.0, gnutls, goocanvas-2.0, gobject-2.0, gobject-introspection-1.0, grilo-0.3, grilo-net-0.3, gssdp-1.0, gst-editing-services-1.0, gstreamer-1.0, gstreamer-allocators-1.0, gstreamer-app-1.0, gstreamer-audio-1.0, gstreamer-base-1.0, gstreamer-check-1.0, gstreamer-controller-1.0, gstreamer-fft-1.0, gstreamer-net-1.0, gstreamer-pbutils-1.0, gstreamer-player-1.0, gstreamer-riff-1.0, gstreamer-rtp-1.0, gstreamer-rtsp-1.0, gstreamer-rtsp-server-1.0, gstreamer-sdp-1.0, gstreamer-tag-1.0, gstreamer-video-1.0, gstreamer-webrtc-1.0, gtk+-3.0, gtk-vnc-2.0, gtk4, gtk4-wayland, gtk4-x11, gtksourceview-5, gupnp-1.0, gupnp-av-1.0, gupnp-dlna-2.0, gupnp-dlna-gst-2.0, gvnc-1.0, gvncpulse-1.0, ibus-1.0, javascriptcoregtk-6.0, json-glib-1.0, libadwaita-1, libcanberra, libcanberra-gtk, libdazzle-1.0, libebook-1.2, libebook-contacts-1.2, libecal-2.0, libecalendar-1.2, libedataserver-1.2, libgda-6.0, libgda-ui-5.0, libgeoclue-2.0, libgdata, libgnome-menu-3.0, libgsf-1, libhandy-1, libical-glib, libmediaart-1.0, libnm, libnm-glib, libnm-util, libnotify, libpeas-1.0, libpeas-gtk-1.0, librsvg-2.0, libsecret-1, libsoup-3.0, libwnck-3.0, pango, pangocairo, rygel-core-2.6, rygel-db-2.6, rygel-renderer-2.6, rygel-renderer-gst-2.6, tracker-control-2.0, tracker-miner-2.0, tracker-sparql-2.0, webkit2gtk-4.1, webkit2gtk-web-extension-4.1, webkitgtk-6.0, webkitgtk-web-extension-6.0, ...";

const wrapInRustCodeBlock = (code: string) => `\`\`\`rust\n${code}\n\`\`\``;

export async function askOpenAIAboutFunction(source: OpSource, method: OpMethod): Promise<OpenAIResponse> {
    if(!source.content) throw new Error('Source content is missing');
   
    const question = `I would like to reimplement the Rust function '${method.definition}' in TypeScript using GJS (GNOME JavaScript). If the implementation is straightforward, proceed with it directly and include a warning that it is still untested. Otherwise, insert a console.warn stating that this method still needs to be implemented. This is meant to be a guide to help me implement it myself, so you don't need to do it for me. What I want is a basic framework that I can build upon. Therefore, also write a meaningful TSDoc comment that helps me understand what the method does and how it might be translated into GJS. Include TSDoc parameters as well. Respond only with a single TypeScript code block. Don't inform me about the difficulty of this task; focus on what the method does and what needs to be implemented in GJS. Always assume that it is feasible.\nRust source code:\n${wrapInRustCodeBlock(source.content)}`
    
    console.debug(question);

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: question },
            ],
            model: "gpt-4",
        });

        console.debug(JSON.stringify(completion, null, 2));

        return { answers: completion.choices.map(c => c.message.content || '') };
    } catch (error) {
        console.error('Error while requesting OpenAI: ', error);
        throw error;
    }
}