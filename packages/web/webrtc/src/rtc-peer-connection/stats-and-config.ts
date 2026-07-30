// Stats + ICE-restart + runtime-configuration methods for
// RTCPeerConnection — extracted via the `install*Methods(proto)` pattern
// (same shape as the SDP-negotiation split, PR #287, and the
// canvas2d-core / webgl2 splits PRs #262/#273).
//
// Covers the W3C `RTCPeerConnection` "live tuning" surface:
//
//   getStats, restartIce, setConfiguration, getConfiguration
//
// They're grouped together because none of them touches the
// media-pipeline construction path (transceivers / tracks / data
// channels) — they only read existing peer state (`getStats`,
// `getConfiguration`), flip negotiation flags (`restartIce`), or
// re-apply a subset of the constructor's policy logic
// (`setConfiguration` calls back into the private
// `_applyIceServers` / `_applyIceTransportPolicy` helpers, which
// stay on the host class).
//
// Method bodies are moved verbatim from the pre-split
// `rtc-peer-connection.ts`. They read/write the host class's
// `_webrtcbin`, `_closed`, `_iceRestartNeeded`, `_hasNegotiated`,
// `_senders`, `_receivers`, `_conf` fields and call the
// `_rejectIfClosed`, `_handleNegotiationNeeded`, `_applyIceServers`,
// `_applyIceTransportPolicy` helpers via their
// `this: RTCPeerConnection` typing. The fields/helpers required by
// these extracted methods are demoted from `private` to
// package-internal (`_`-prefixed) by this PR — same convention as the
// SDP-negotiation split (PR #287).
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC).

import { DOMException } from '@gjsify/dom-exception';
import { withGstPromise } from '../gst-utils.js';
import { parseGstStats, filterStatsByTrackId } from '../gst-stats-parser.js';
import { MediaStreamTrack } from '../media-stream-track.js';
import type { RTCStatsReport } from '../rtc-stats-report.js';
import type { RTCPeerConnection, RTCConfiguration } from '../rtc-peer-connection.js';

export interface StatsAndConfigMethods {
    getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport>;
    restartIce(): void;
    setConfiguration(configuration: RTCConfiguration): void;
    getConfiguration(): RTCConfiguration;
}

declare module '../rtc-peer-connection.js' {
    interface RTCPeerConnection extends StatsAndConfigMethods {}
}

const statsAndConfigMethods: StatsAndConfigMethods & ThisType<RTCPeerConnection> = {
    async getStats(this: RTCPeerConnection, selector?: MediaStreamTrack | null): Promise<RTCStatsReport> {
        this._rejectIfClosed('getStats');

        // Validate selector — if a track is given, it must belong to a sender or receiver
        if (selector != null && selector instanceof MediaStreamTrack) {
            const hasSender = this._senders.some((s) => s.track === selector);
            const hasReceiver = this._receivers.some((r) => r.track === selector);
            if (!hasSender && !hasReceiver) {
                throw new DOMException(
                    'The selector track is not associated with a sender or receiver of this connection',
                    'InvalidAccessError',
                );
            }
        }

        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('get-stats', null, p);
        });

        const report = parseGstStats(reply);

        // If a track selector was provided, filter to relevant stats
        if (selector != null && selector instanceof MediaStreamTrack) {
            return filterStatsByTrackId(report, selector.id);
        }

        return report;
    },

    // ---- ICE restart / reconfiguration (Phase 4.4) ---------------------------

    restartIce(this: RTCPeerConnection): void {
        if (this._closed) return; // no-op on closed connections per spec
        this._iceRestartNeeded = true;
        // Route through the shared § 4.7.3 mechanism: fires (queued) only
        // once at least one negotiation has completed — before that,
        // restartIce has no observable effect.
        this._updateNegotiationNeeded();
    },

    setConfiguration(this: RTCPeerConnection, configuration: RTCConfiguration): void {
        this._rejectIfClosed('setConfiguration');

        // Per spec: bundlePolicy and rtcpMuxPolicy cannot change after construction
        if (configuration.bundlePolicy && configuration.bundlePolicy !== (this._conf.bundlePolicy ?? 'balanced')) {
            throw new DOMException('setConfiguration: bundlePolicy cannot be changed', 'InvalidModificationError');
        }
        if (configuration.rtcpMuxPolicy && configuration.rtcpMuxPolicy !== (this._conf.rtcpMuxPolicy ?? 'require')) {
            throw new DOMException('setConfiguration: rtcpMuxPolicy cannot be changed', 'InvalidModificationError');
        }

        // Apply new ICE servers
        if (configuration.iceServers) {
            this._applyIceServers(configuration.iceServers);
        }
        // Apply new ICE transport policy
        if (configuration.iceTransportPolicy) {
            this._applyIceTransportPolicy(configuration.iceTransportPolicy);
        }

        this._conf = { ...this._conf, ...configuration };
    },

    getConfiguration(this: RTCPeerConnection): RTCConfiguration {
        return { ...this._conf };
    },
};

/** Install stats + restartIce + setConfiguration / getConfiguration on RTCPeerConnection.prototype. */
export function installStatsAndConfigMethods(proto: object): void {
    Object.assign(proto, statsAndConfigMethods);
}
