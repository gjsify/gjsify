// The capture chain's pure and sink-free parts. Which real source wins is a
// property of the host, so nothing here asserts it — only that the chain
// ends in a pipeline that holds the source and that constraints become caps.

import { describe, it, expect } from '@gjsify/unit';

import { Gst, ensureGstInit } from './gst-init.js';
import { buildAudioCaps, buildVideoCaps, isTestSource, openCapture } from './capture-source.js';

export default async () => {
    await describe('capture caps', async () => {
        await it('maps audio constraints to caps', async () => {
            expect(buildAudioCaps({ sampleRate: 16000.9, channelCount: 1 })).toBe('audio/x-raw,rate=16000,channels=1');
        });

        await it('maps video constraints to caps', async () => {
            expect(buildVideoCaps({ width: 640, height: 480, frameRate: 30 })).toBe(
                'video/x-raw,width=640,height=480,framerate=30/1',
            );
        });

        await it('returns null when no constraint maps to caps', async () => {
            expect(buildAudioCaps({ deviceId: 'x' })).toBe(null);
            expect(buildVideoCaps({})).toBe(null);
        });
    });

    await describe('openCapture', async () => {
        await it('opens an audio source in an unstarted pipeline', async () => {
            ensureGstInit();
            const { source, pipeline } = openCapture('audio', { sampleRate: 16000 });
            expect(pipeline.get_by_name(source.name) !== null).toBe(true);
            expect(pipeline.get_state(0)[1]).toBe(Gst.State.NULL);
        });

        await it('puts a capsfilter behind the source only when a constraint asks for one', async () => {
            ensureGstInit();
            const linked = (c: ReturnType<typeof openCapture>) => c.source.get_static_pad('src')!.is_linked();
            expect(linked(openCapture('audio'))).toBe(false);
            expect(linked(openCapture('audio', { channelCount: 1 }))).toBe(true);
        });

        await it('recognises a synthetic test source by its factory', async () => {
            ensureGstInit();
            expect(isTestSource(Gst.ElementFactory.make('audiotestsrc', null)!)).toBe(true);
            expect(isTestSource(Gst.ElementFactory.make('fakesrc', null)!)).toBe(false);
        });
    });
};
