import { byteArray } from '@gjsify/types/Gjs';
import Soup from '@gjsify/types/Soup-3.0';
import Gio from '@gjsify/types/Gio-2.0';
import { ExtInputStream } from '@gjsify/gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

/**
 * Extended version of Soup..
 * 
 * Features:
 *  * 
 */
export class ExtSession<T extends Soup.Session = Soup.Session> {

    private constructor() {}

    /**
     * Creates a new instance of `ExtSession` based on a existing `Soup.Session` instance.
     * @param session The original unextended `Soup.Session`
     * @returns The `Soup.Session` instance extended to `ExtSession`
     */
    static create<T extends Soup.Session = Soup.Session>(session: T): ExtSession & T {
        const self = new ExtSession<T>();

        const extSession = session as T & ExtSession;

        // Extend `Soup.Session` to `ExtSession`
        extSession.sendAsync = self.sendAsync;
        return extSession;
    }

    /**
     * Creates a new instance of `Soup.Session` extended to `ExtSession`
     * @param config 
     * @returns 
     */
     static new(config: Soup.Session.ConstructorProperties = {}) {
        const session = new Soup.Session(config);
        return this.create<Soup.Session>(session);
    }


    /**
     * Promise version of `Soup.session.send_async` / `Soup.session.send_finish`
     * @param msg A `Soup.Message` message
     * @param ioPriority The I/O priority of the request
     * @param cancellable `Gio.Cancellable` object, `null` to ignore.
     * @return The data or `null` if the end is reached
     */
    async sendAsync(this: T & ExtSession, msg: Soup.Message, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<ExtInputStream<Gio.InputStream> & Gio.InputStream>((resolve, reject) => {
            this.send_async(msg, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const inputStream = this.send_finish(asyncRes)
                    const extInputStream = ExtInputStream.create(inputStream);
                    resolve(extInputStream);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

}

