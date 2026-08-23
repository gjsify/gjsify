<!-- The acronym case, and the only reason `WidgetPropsVueAliases` exists.
     Volar's camelize has no acronym knowledge: it turns `gtk-gl-area` into
     `GtkGlArea` and MISSES the `GtkGLArea` key, so the generator emits an extra
     kebab key for every GType with two adjacent capitals. 1 of 164 today, found
     by rule rather than by bug report — this fixture is what keeps that rule
     honest when the GIR gains another one. -->
<template>
    <gtk-gl-area :has-stencil-buffer="true" />
    <GtkGLArea :auto-render="false" />
</template>
