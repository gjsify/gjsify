/**
 * A five-class GIR, so the generator is testable without the 6.2 MB one.
 *
 * Every element here earns its place by exercising a branch the real GIR cannot
 * exercise ON DEMAND:
 *
 *  - `Orientable.label` is a `gint` and `Box.label` a `utf8`, so the two bases of
 *    `MiniBoxProps` disagree and the `Omit` machinery has to fire. Measured, the
 *    real Gtk+Adw hierarchy produces ZERO such conflicts, which left that code
 *    shipped and unexercised — this is what turns it into a tested path.
 *  - `baseline_fill` is a two-word enum member, so the GIR-underscore-to-nick
 *    substitution is visible.
 *  - `css-classes` is an ARRAY of a scalar, the case a descendant `<type>` lookup
 *    gets wrong by answering `string` for `string[]`.
 *  - `locked` is readable and NOT writable, so the writable filter has something to
 *    drop.
 *  - `MiniGLThing` has two adjacent capitals, so `tagOf`'s acronym rule and the
 *    Volar-resolution gap both have a case.
 *  - `Nameless` has no `glib:type-name`, and `NotAWidget` does not descend from the
 *    root — the two reasons a class is skipped.
 *
 * Embedded as a string rather than a file: the test bundle runs under gjs from a
 * path that is not the source tree, and a fixture that cannot be found is a test
 * that silently checks nothing.
 */

export const MINI_GIR = `<?xml version="1.0"?>
<repository version="1.2"
            xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
  <namespace name="Mini" version="1.0">
    <enumeration name="Align" glib:type-name="MiniAlign">
      <member name="fill" value="0"/>
      <member name="baseline_fill" value="1"/>
    </enumeration>
    <bitfield name="StateFlags" glib:type-name="MiniStateFlags">
      <member name="active" value="1"/>
    </bitfield>
    <record name="Rect" c:type="MiniRect"/>
    <interface name="Orientable" glib:type-name="MiniOrientable">
      <doc xml:space="preserve">Anything with an orientation. Second sentence, dropped.</doc>
      <property name="orientation" writable="1">
        <doc xml:space="preserve">Which way round it goes.</doc>
        <type name="Align"/>
      </property>
      <property name="label" writable="1">
        <type name="gint"/>
      </property>
    </interface>
    <class name="Widget" glib:type-name="MiniWidget" abstract="1" parent="GObject.Object">
      <property name="visible" writable="1"><type name="gboolean"/></property>
      <property name="css-classes" writable="1"><array><type name="utf8"/></array></property>
      <property name="locked"><type name="gint"/></property>
      <property name="area" writable="1"><type name="Rect"/></property>
      <glib:signal name="destroy"/>
      <method name="show"/>
    </class>
    <class name="Box" glib:type-name="MiniBox" parent="Widget">
      <implements name="Orientable"/>
      <property name="spacing" writable="1"><type name="gint"/></property>
      <property name="label" writable="1"><type name="utf8"/></property>
      <property name="old-thing" writable="1" deprecated="1"><type name="gboolean"/></property>
      <glib:signal name="row-activated" version="1.2">
        <parameters>
          <parameter name="row"><type name="Widget"/></parameter>
          <parameter name="how"><type name="Align"/></parameter>
        </parameters>
      </glib:signal>
      <method name="append"/>
      <method name="remove"/>
    </class>
    <class name="GLThing" glib:type-name="MiniGLThing" parent="Widget">
      <property name="mode" writable="1"><type name="Align"/></property>
      <property name="flags" writable="1"><type name="StateFlags"/></property>
    </class>
    <class name="Nameless" parent="Widget"/>
    <class name="NotAWidget" glib:type-name="MiniNotAWidget" parent="GObject.Object"/>
  </namespace>
</repository>
`;

/** The fixture's own namespace-to-package map, which the real one has no entry for. */
export const MINI_PACKAGES = { Mini: '@girs/mini-1.0' } as const;
