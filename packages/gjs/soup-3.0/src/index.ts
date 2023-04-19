import Soup from '@gjsify/types/Soup-3.0';
import Gio from 'gi://Gio?version=2.0';
import { ExtInputStream } from '@gjsify/gio-2.0';
import GLib from 'gi://GLib?version=2.0';

// This interface is used for pseudo extend Soup.Session
export interface ExtSession extends Soup.Session {}

/**
 * Extended version of Soup..
 * 
 * Features:
 *  * 
 */
export class ExtSession<T extends Soup.Session = Soup.Session> {

    protected constructor(session: T) {
        const extSession = session as T & ExtSession;

        // Extend `Soup.Session` to `ExtSession`
        extSession.sendAsync = this.sendAsync;
        return extSession;
    }

    /**
     * Creates a new instance of `ExtSession` based on a existing `Soup.Session` instance.
     * @param session The original unextended `Soup.Session`
     * @returns The `Soup.Session` instance extended to `ExtSession`
     */
    static extend<T extends Soup.Session = Soup.Session>(session: T) {
        return new this<Soup.Session>(session);
    }

    /**
     * Creates a new instance of `Soup.Session` extended to `ExtSession`
     * @param config 
     * @returns 
     */
    static new<T extends Soup.Session = Soup.Session>(config: Soup.Session.ConstructorProperties = {}) {
        const session = new Soup.Session(config) as T & ExtSession<T>;
        return new this<Soup.Session>(session);
    }

    /**
     * Promise version of `Soup.session.send_async` / `Soup.session.send_finish`
     * @param msg A `Soup.Message` message
     * @param ioPriority The I/O priority of the request
     * @param cancellable `Gio.Cancellable` object, `null` to ignore.
     * @return The data or `null` if the end is reached
     */
    async sendAsync(msg: Soup.Message, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<ExtInputStream<Gio.InputStream> & Gio.InputStream>((resolve, reject) => {
            this.send_async(msg, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const inputStream = this.send_finish(asyncRes)
                    const extInputStream = ExtInputStream.extend(inputStream);
                    resolve(extInputStream);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}

