// @gjsify/devtools-mcp — the tool-profile extension API.
// Original implementation.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbusDevtoolsClient } from './dbus-client.js';
import type { ToolResult } from './tool-result.js';

/** The generic per-app tool names the bridge can register. */
export type GenericToolName =
    | 'get_status'
    | 'screenshot'
    | 'list_actions'
    | 'activate_action'
    | 'change_action_state'
    | 'present_window'
    | 'resize_window'
    | 'list_instances'
    | 'list_toplevels'
    | 'dump_tree'
    | 'get_property'
    | 'get_focused'
    | 'dump_gsettings'
    | 'dump_css'
    | 'swap_css';

/** Context handed to the generic tool registrations and to a profile's `registerTools`. */
export interface McpToolContext {
    readonly server: McpServer;
    readonly client: DbusDevtoolsClient;
    readonly ok: (text: string) => ToolResult;
    readonly fail: (text: string) => ToolResult;
    readonly dbusError: (error: unknown, instance?: string) => ToolResult;
}

/** Describes an MCP bridge for a specific app (or the generic default). */
export interface DevtoolsToolProfile {
    /** MCP server name. */
    readonly name: string;
    /** MCP server version. */
    readonly version: string;
    /** The app's base DBus name, e.g. `"org.example.App"`. */
    readonly busNameBase: string;
    /** Which generic tools to register. Default: `'all'`. */
    readonly genericTools?: GenericToolName[] | 'all';
    /**
     * Register app-specific tools on top of the generic ones. May be async —
     * a profile that lazily loads an optional peer (e.g. the CDP profile) returns
     * a promise; `runDevtoolsMcp` fires it and `.catch()`es it rather than
     * awaiting (awaiting before `loop.run()` breaks the nested GJS main loop).
     */
    readonly registerTools?: (ctx: McpToolContext) => void | Promise<void>;
}
