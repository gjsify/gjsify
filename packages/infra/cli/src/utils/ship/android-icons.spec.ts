import { describe, expect, it } from '@gjsify/unit';

import {
    ANDROID_ICONS_GENERATOR_VERSION,
    adaptiveIconXml,
    backgroundXml,
    buildStamp,
    checkStamp,
    hashInputs,
    normalizeColor,
    parseAppResourcesPath,
    parseMetainfoBranding,
    pickIconSources,
    planAndroidIcons,
    resolveBackground,
    resolveResourcesName,
    wrapperSvg,
} from './android-icons.js';

const enc = (text: string) => new TextEncoder().encode(text);

export default async () => {
    await describe('android-icons: plan', async () => {
        await it('emits the launcher sizes per density', async () => {
            const plan = planAndroidIcons({ background: '#84BBFD', monochrome: true });
            const size = (path: string) => plan.png.find((p) => p.path === path)?.size;
            expect(size('mipmap-mdpi/ic_launcher.png')).toBe(48);
            expect(size('mipmap-xxxhdpi/ic_launcher.png')).toBe(192);
            expect(size('mipmap-hdpi/ic_launcher_round.png')).toBe(72);
            expect(size('mipmap-mdpi/ic_launcher_foreground.png')).toBe(108);
            expect(size('mipmap-hdpi/ic_launcher_foreground.png')).toBe(162);
            expect(size('mipmap-xxxhdpi/ic_launcher_monochrome.png')).toBe(432);
            expect(size('drawable-ldpi/logo.png')).toBe(72);
        });
        await it('omits the monochrome layer without a symbolic icon', async () => {
            const plan = planAndroidIcons({ background: '#FFFFFF', monochrome: false });
            expect(plan.png.some((p) => p.kind === 'monochrome')).toBe(false);
            expect(adaptiveIconXml(false).includes('monochrome')).toBe(false);
            expect(adaptiveIconXml(true).includes('@mipmap/ic_launcher_monochrome')).toBe(true);
        });
        await it('writes the background colour resource', async () => {
            expect(backgroundXml('#84BBFD').includes('>#84BBFD<')).toBe(true);
        });
    });

    await describe('android-icons: wrapper geometry', async () => {
        await it('puts the foreground into the 66dp safe zone of a 108dp canvas', async () => {
            const svg = wrapperSvg('foreground', enc('<svg/>'), '#fff');
            expect(svg.includes('viewBox="0 0 108 108"')).toBe(true);
            expect(svg.includes('x="21" y="21" width="66" height="66"')).toBe(true);
        });
        await it('draws the round icon on a circle', async () => {
            const svg = wrapperSvg('round', enc('<svg/>'), '#84BBFD');
            expect(svg.includes('<circle')).toBe(true);
            expect(svg.includes('fill="#84BBFD"')).toBe(true);
        });
    });

    await describe('android-icons: option resolution', async () => {
        await it('normalizes colours', async () => {
            expect(normalizeColor('#abc')).toBe('#AABBCC');
            expect(normalizeColor(' #84bbfd ')).toBe('#84BBFD');
            expect(normalizeColor('blue')).toBe(null);
        });
        await it('reads the light branding colour', async () => {
            const xml = `<branding><color type="primary" scheme_preference="dark">#1A5FB4</color>
<color type="primary" scheme_preference="light">#84BBFD</color></branding>`;
            expect(parseMetainfoBranding(xml)).toBe('#84BBFD');
            expect(parseMetainfoBranding('<component/>')).toBe(null);
        });
        await it('prefers flag over config over metainfo over white', async () => {
            expect(resolveBackground({ flag: '#111', configured: '#222', fromMetainfo: '#333333' })).toBe('#111111');
            expect(resolveBackground({ configured: '#222', fromMetainfo: '#333333' })).toBe('#222222');
            expect(resolveBackground({ fromMetainfo: '#333333' })).toBe('#333333');
            expect(resolveBackground({ fromMetainfo: null })).toBe('#FFFFFF');
        });
        await it('refuses a non-colour', async () => {
            let message = '';
            try {
                resolveBackground({ flag: 'red', fromMetainfo: null });
            } catch (e) {
                message = (e as Error).message;
            }
            expect(message.includes('not a colour')).toBe(true);
        });
        await it('reads appResourcesPath and falls back', async () => {
            expect(parseAppResourcesPath('export default { appResourcesPath: "data", x: 1 }')).toBe('data');
            expect(resolveResourcesName({ nativescriptConfig: 'appResourcesPath: "data"' })).toBe('data');
            expect(resolveResourcesName({ flag: 'r', nativescriptConfig: 'appResourcesPath: "data"' })).toBe('r');
            expect(resolveResourcesName({ nativescriptConfig: null })).toBe('App_Resources');
        });
        await it('picks the scalable icon and its symbolic twin', async () => {
            const picked = pickIconSources([
                'a/hicolor/symbolic/apps/x-symbolic.svg',
                'a/hicolor/scalable/apps/x.svg',
                'a/other/logo.svg',
            ]);
            expect(picked.icon).toBe('a/hicolor/scalable/apps/x.svg');
            expect(picked.symbolic).toBe('a/hicolor/symbolic/apps/x-symbolic.svg');
            expect(pickIconSources([]).icon).toBe(null);
        });
    });

    await describe('android-icons: stamp', async () => {
        const plan = planAndroidIcons({ background: '#FFFFFF', monochrome: false });
        const inputs = hashInputs({ icon: enc('a'), symbolic: null, background: '#FFFFFF' });
        const stamp = JSON.stringify(buildStamp(inputs, plan, 'Android/src/main/res'));
        await it('depends on every input', async () => {
            expect(hashInputs({ icon: enc('b'), symbolic: null, background: '#FFFFFF' })).not.toBe(inputs);
            expect(hashInputs({ icon: enc('a'), symbolic: enc('s'), background: '#FFFFFF' })).not.toBe(inputs);
            expect(hashInputs({ icon: enc('a'), symbolic: null, background: '#000000' })).not.toBe(inputs);
            expect(hashInputs({ icon: enc('a'), symbolic: null, background: '#FFFFFF' })).toBe(inputs);
        });
        await it('is current when inputs match and all files exist', async () => {
            expect(checkStamp(stamp, inputs, () => true).current).toBe(true);
            expect(JSON.parse(stamp).generator).toBe(ANDROID_ICONS_GENERATOR_VERSION);
        });
        await it('is stale when missing, changed or a file is gone', async () => {
            expect(checkStamp(null, inputs, () => true).current).toBe(false);
            expect(checkStamp('{', inputs, () => true).current).toBe(false);
            expect(checkStamp(stamp, 'other', () => true).current).toBe(false);
            expect(checkStamp(stamp, inputs, (f) => !f.endsWith('logo.png')).current).toBe(false);
        });
    });
};
