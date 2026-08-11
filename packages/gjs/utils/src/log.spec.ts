import { describe } from '@gjsify/unit';

const _createUncaughtException = async () => {
    throw new Error('top level error');
};

const _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export default async () => {
    await describe('logSignals', async () => {
        // TODO(open-todos: logSignals has no test): `it.failing` cannot park this one
        // — the event under test IS an unhandled rejection, raised outside the
        // callback's promise chain, and Node's default handler ends the process. It
        // needs a test written around a temporary rejection handler.
    });
};
