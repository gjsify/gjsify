import { describe, it, expect } from '@gjsify/unit';

import * as SoupExt from './index.js';
import * as GioExt from '@gjsify/gio-2.0';
import Soup from "@gjsify/types/Soup-3.0";
import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

export default async () => {
	await describe('SoupExt.ExtSession.sendAsync', async () => {

		await it('Should be able to successfully perform a get request using its own helper methods', async () => {
			const url = 'https://zelda-api.apius.cc/api/games?limit=10';
			const session = SoupExt.ExtSession.new();
			const method = 'GET'
			const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
			const message = new Soup.Message({
				method,
				uri,
			});

			// Send request
			const extInputStream = await session.sendAsync(message);

			// Get request status
			const { status_code, reason_phrase } = message;
			const ok = status_code >= 200 && status_code < 300;

			print("    status_code", status_code);
			print("    reason_phrase", reason_phrase);

			expect(ok).toBeTruthy();

			// Get response data
			const extOutputStream = await extInputStream.spliceAsync();

			// To GLib.Bytes
			const bodyBytes = extOutputStream.steal_as_bytes();
			
			// To Uint8Array
			const bodyUInt8Array = (bodyBytes as any).toArray() as Uint8Array; // TODO fix this in ts-for-gir
			
			// To Text
			const bodyText = new TextDecoder().decode(bodyUInt8Array);

			// To Object
			const games = JSON.parse(bodyText);

			for (const game of games.data) {
				print('    ' + game.name);
				expect(typeof game.name).toBe("string");
			}
			
			expect(typeof bodyText).toBe("string");
			expect(typeof games).toBe("object");
		});
	});
}
