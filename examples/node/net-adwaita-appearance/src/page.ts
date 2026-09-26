// The page half. Importing adwaita-web registers the widgets and reads the
// `<meta name="adw-accent">` tags the server rendered, so the first paint already
// has the desktop's accent. The EventSource below is only for LIVE changes.

import { adwaitaAccentSource, applyDesktopAppearance } from '@gjsify/adwaita-web';

const source = document.getElementById('source');
const showSource = () => {
    if (source) source.textContent = adwaitaAccentSource();
};
showSource();

new EventSource('/appearance').addEventListener('message', (event: MessageEvent<string>) => {
    applyDesktopAppearance(JSON.parse(event.data));
    showSource();
});
