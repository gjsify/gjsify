// SPDX-License-Identifier: MIT
// Unit coverage for the `next`-channel notice in `gjsify self-update`.
//
// WHY THIS IS A TEST AND NOT A COMMENT. The notice exists because the channel has no
// memory: `--tag` is the whole mechanism (ADR 0111), so a bare `self-update` on a `next`
// build installs `latest` and silently takes the user off the channel. The notice is the
// only thing standing between that and a bug report reading "my prerelease fix vanished".
//
// Both halves of its condition are the kind that rot unnoticed:
//
//   1. "is a next prerelease" must read the prerelease IDENTIFIER, not the string. The
//      substring test passes every case a developer thinks to try by hand and then fires
//      on `1.2.3-nextgen.1`, which is a different preid entirely.
//   2. "no explicit --tag" only exists because the yargs `default: 'latest'` was removed.
//      Putting it back makes `requestedTag` always a string, the notice never fires, and
//      nothing else in the suite notices — the command still does the right install.

import { describe, expect, it } from '@gjsify/unit';

import { isNextChannelVersion, nextChannelNotice } from './self-update.js';

export default async () => {
    await describe('self-update — the next-channel notice', async () => {
        await describe('isNextChannelVersion — the preid, not the substring', async () => {
            await it('accepts the shape publish-next publishes', async () => {
                expect(isNextChannelVersion('0.63.1-next.42')).toBe(true);
                expect(isNextChannelVersion('1.0.0-next.1')).toBe(true);
            });

            await it('rejects a stable release', async () => {
                expect(isNextChannelVersion('0.63.0')).toBe(false);
                expect(isNextChannelVersion('0.63.1')).toBe(false);
            });

            await it('rejects another preid that merely starts with next', async () => {
                // The case a substring test gets wrong, and the reason this is parsed.
                expect(isNextChannelVersion('1.2.3-nextgen.1')).toBe(false);
                expect(isNextChannelVersion('1.2.3-nextish')).toBe(false);
            });

            await it('rejects next in build metadata', async () => {
                expect(isNextChannelVersion('1.2.3-beta.1+next')).toBe(false);
                expect(isNextChannelVersion('1.2.3+next.42')).toBe(false);
            });

            await it('rejects an unknown version without throwing', async () => {
                // `readCurrentVersion()` answers null when it cannot tell, and an
                // unparseable version is the same "cannot say" — never a notice.
                expect(isNextChannelVersion(null)).toBe(false);
                expect(isNextChannelVersion(undefined)).toBe(false);
                expect(isNextChannelVersion('')).toBe(false);
                expect(isNextChannelVersion('not-a-version')).toBe(false);
            });
        });

        await describe('nextChannelNotice — fires on exactly one combination', async () => {
            await it('notices a next build updating without --tag', async () => {
                const notice = nextChannelNotice({
                    currentVersion: '0.63.1-next.42',
                    requestedTag: undefined,
                });
                expect(notice).toBeTruthy();
                // The two facts the line has to carry: where it moves you, and how to stay.
                expect(notice?.includes('0.63.1-next.42')).toBe(true);
                expect(notice?.includes('latest')).toBe(true);
                expect(notice?.includes('--tag next')).toBe(true);
            });

            await it('is one line', async () => {
                // It precedes the normal output of a command the user did ask for; a
                // paragraph here reads like a warning about something going wrong.
                const notice = nextChannelNotice({
                    currentVersion: '0.63.1-next.42',
                    requestedTag: undefined,
                });
                expect(notice?.includes('\n')).toBe(false);
            });

            await it('stays silent when --tag was passed explicitly', async () => {
                // Including `--tag latest`: that IS the user asking to leave the channel.
                expect(nextChannelNotice({ currentVersion: '0.63.1-next.42', requestedTag: 'latest' })).toBe(null);
                expect(nextChannelNotice({ currentVersion: '0.63.1-next.42', requestedTag: 'next' })).toBe(null);
                expect(nextChannelNotice({ currentVersion: '0.63.1-next.42', requestedTag: '0.62.0' })).toBe(null);
            });

            await it('stays silent on a stable build', async () => {
                expect(nextChannelNotice({ currentVersion: '0.63.0', requestedTag: undefined })).toBe(null);
                expect(nextChannelNotice({ currentVersion: null, requestedTag: undefined })).toBe(null);
            });
        });
    });
};
