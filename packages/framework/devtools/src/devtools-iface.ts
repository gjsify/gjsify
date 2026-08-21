// @gjsify/devtools — the org.gjsify.Devtools DBus interface XML.
// Original implementation.

import { DEVTOOLS_INTERFACE } from '@gjsify/devtools-protocol';

/** The generic (Phase 1) method fragments — JSON-in-strings carry the contract envelope. */
const GENERIC_METHODS_XML = `    <method name="GetStatus">
      <arg type="s" direction="out" name="status_json"/>
    </method>
    <method name="Screenshot">
      <arg type="s" direction="in" name="scope"/>
      <arg type="ay" direction="out" name="png_bytes"/>
    </method>
    <method name="ListActions">
      <arg type="s" direction="out" name="actions_json"/>
    </method>
    <method name="ActivateAction">
      <arg type="s" direction="in" name="scope"/>
      <arg type="s" direction="in" name="name"/>
      <arg type="s" direction="in" name="value_json"/>
    </method>
    <method name="ChangeActionState">
      <arg type="s" direction="in" name="scope"/>
      <arg type="s" direction="in" name="name"/>
      <arg type="s" direction="in" name="value_json"/>
    </method>
    <method name="PresentWindow"/>
    <method name="ResizeWindow">
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="i" direction="out" name="result_width"/>
      <arg type="i" direction="out" name="result_height"/>
    </method>
    <method name="ListToplevels">
      <arg type="s" direction="out" name="toplevels_json"/>
    </method>
    <method name="DumpTree">
      <arg type="s" direction="in" name="root"/>
      <arg type="i" direction="in" name="depth"/>
      <arg type="s" direction="out" name="tree_json"/>
    </method>
    <method name="GetProperty">
      <arg type="s" direction="in" name="path"/>
      <arg type="s" direction="in" name="prop"/>
      <arg type="s" direction="out" name="value_json"/>
    </method>
    <method name="GetFocused">
      <arg type="s" direction="out" name="focused_json"/>
    </method>
    <method name="ActivateWidget">
      <arg type="s" direction="in" name="path"/>
      <arg type="b" direction="out" name="activated"/>
    </method>
    <method name="FindWidget">
      <arg type="s" direction="in" name="selector"/>
      <arg type="s" direction="out" name="path"/>
    </method>
    <method name="DumpGSettings">
      <arg type="s" direction="in" name="schema_id"/>
      <arg type="s" direction="out" name="settings_json"/>
    </method>
    <method name="DumpCss">
      <arg type="s" direction="out" name="css_json"/>
    </method>
    <method name="SwapCss">
      <arg type="s" direction="in" name="name"/>
      <arg type="s" direction="in" name="css"/>
      <arg type="b" direction="out" name="applied"/>
    </method>`;

/**
 * Assemble the full `org.gjsify.Devtools` introspection node XML, merging any
 * app-specific `<method>…</method>` fragments contributed by extensions into
 * the single interface — so app-specific methods are driveable over the same
 * bus object as the generic ones.
 */
export function buildDevtoolsIfaceXml(extraMethodsXml: readonly string[] = []): string {
    const extra = extraMethodsXml.length > 0 ? `\n${extraMethodsXml.join('\n')}` : '';
    return `<node>
  <interface name="${DEVTOOLS_INTERFACE}">
${GENERIC_METHODS_XML}${extra}
  </interface>
</node>`;
}
