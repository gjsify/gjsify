import { describe, expect, it } from '@gjsify/unit';

import { SpeechRecognitionAlternative, SpeechRecognitionResult, SpeechRecognitionResultList } from './results.js';

export default async () => {
    await describe('result classes', async () => {
        await it('index alternatives and results both ways', async () => {
            const alt = new SpeechRecognitionAlternative('hallo', 0.9);
            const result = new SpeechRecognitionResult({
                alternatives: [alt],
                isFinal: true,
                speechStartTime: 1,
                speechEndTime: 2,
            });
            const list = new SpeechRecognitionResultList([result]);
            expect(list.length).toBe(1);
            expect(list[0]).toBe(result);
            expect(list.item(0).item(0)).toBe(alt);
            expect(result[0].transcript).toBe('hallo');
            expect(result.speechEndTime).toBe(2);
            expect([...list].length).toBe(1);
        });
    });
};
