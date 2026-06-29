# Changelog

## [0.14.0](https://github.com/gjsify/gjsify/compare/v0.13.2...v0.14.0) (2026-06-29)

### Features

* **node-gi:** marshal interface-typed properties ([#676](https://github.com/gjsify/gjsify/issues/676)) ([0ad70da](https://github.com/gjsify/gjsify/commit/0ad70da57cda1d918b9ec3c98c50d8bc0ad5fd2c)), closes [#659](https://github.com/gjsify/gjsify/issues/659)
* **node-gi:** pass signal emitter to JS handlers ([#677](https://github.com/gjsify/gjsify/issues/677)) ([25cc42a](https://github.com/gjsify/gjsify/commit/25cc42a6dc23778c411ae76c419212699f22ac03)), closes [#675](https://github.com/gjsify/gjsify/issues/675)
* **storybook:** add --runtime node to run on Node ([#678](https://github.com/gjsify/gjsify/issues/678)) ([56a5ef8](https://github.com/gjsify/gjsify/commit/56a5ef85a7e5eb49ad1dc1a7f1d24769a2277794))

### Bug Fixes

* **adwaita-nativescript:** GJS-parity (sizes, insets, status page, …) ([#672](https://github.com/gjsify/gjsify/issues/672)) ([7bbf2d4](https://github.com/gjsify/gjsify/commit/7bbf2d4fa0c2bab489d193d27df9a784fa4858b4))

## [0.13.2](https://github.com/gjsify/gjsify/compare/v0.13.1...v0.13.2) (2026-06-29)

### Features

* **node-gi:** accept camelCase construct keys ([#671](https://github.com/gjsify/gjsify/issues/671)) ([7161935](https://github.com/gjsify/gjsify/commit/7161935e28e18dd243fdeb4a902583db324b28f5))
* **node-gi:** add Gio.Application.runAsync ([#670](https://github.com/gjsify/gjsify/issues/670)) ([db50158](https://github.com/gjsify/gjsify/commit/db50158a64b03f0320f054fc60f40fc0d4cd5294)), closes [442/#121](https://github.com/442/gjsify/issues/121)
* **node-gi:** add GObject.registerClass decorator ([#650](https://github.com/gjsify/gjsify/issues/650)) ([657a031](https://github.com/gjsify/gjsify/commit/657a031601d9588845100e771b07b0421d2720f5))
* **node-gi:** add Gtk.Template signal-callback dispatch ([#666](https://github.com/gjsify/gjsify/issues/666)) ([5dafd30](https://github.com/gjsify/gjsify/commit/5dafd3027dd65a427bf04c283af211fbe6258585))
* **node-gi:** add L1 requireGi wrapper ([#637](https://github.com/gjsify/gjsify/issues/637)) ([a6aa8a8](https://github.com/gjsify/gjsify/commit/a6aa8a810a89b7c30c4213b53bea54fde11cf95f))
* **node-gi:** add ParamSpec.object/.boxed + real $gtype ([#667](https://github.com/gjsify/gjsify/issues/667)) ([97f312a](https://github.com/gjsify/gjsify/commit/97f312aa91122a27709056e3ae62bfcac93a1aea))
* **node-gi:** bare system/gettext ESM modules ([#665](https://github.com/gjsify/gjsify/issues/665)) ([4cd8d45](https://github.com/gjsify/gjsify/commit/4cd8d45fc3dc5b8b9dbf2f03379f434269ca4cc3)), closes [#641](https://github.com/gjsify/gjsify/issues/641) [#649](https://github.com/gjsify/gjsify/issues/649)
* **node-gi:** construct GObjects + properties ([#632](https://github.com/gjsify/gjsify/issues/632)) ([76469ce](https://github.com/gjsify/gjsify/commit/76469ce409e9d796ec061994af7555ea1ac03922))
* **node-gi:** dual gjs+node Adwaita GTK capstone ([#662](https://github.com/gjsify/gjsify/issues/662)) ([b1da64e](https://github.com/gjsify/gjsify/commit/b1da64ef09f9b3c5c3229e9d7b876e472f9bf6dd))
* **node-gi:** dual gjs+node capstone example ([#651](https://github.com/gjsify/gjsify/issues/651)) ([d653dbe](https://github.com/gjsify/gjsify/commit/d653dbe893a132dc36a0c426deea5b09a4eb3955))
* **node-gi:** inject globals shim on --app node ([#649](https://github.com/gjsify/gjsify/issues/649)) ([2b97030](https://github.com/gjsify/gjsify/commit/2b97030f2a07b28a2a35f7ad5f365fbc6b30230d)), closes [#1](https://github.com/gjsify/gjsify/issues/1)
* **node-gi:** instance methods + marshalling ([#635](https://github.com/gjsify/gjsify/issues/635)) ([ca190c3](https://github.com/gjsify/gjsify/commit/ca190c39fe5362eebddbe5112c0d9ee7b5834b15))
* **node-gi:** mainloop bridge + boxed GMainLoop ([#642](https://github.com/gjsify/gjsify/issues/642)) ([a7f3208](https://github.com/gjsify/gjsify/commit/a7f3208e6971e401a3b87b0d693d3f3324665e3c)), closes [442/#121](https://github.com/442/gjsify/issues/121)
* **node-gi:** marshal arrays/lists/hashes + GStrv ([#653](https://github.com/gjsify/gjsify/issues/653)) ([60296ef](https://github.com/gjsify/gjsify/commit/60296ef3c1e45b1dbc324859194655a4f9c3eb22)), closes [#652](https://github.com/gjsify/gjsify/issues/652)
* **node-gi:** marshal GStrv construct properties ([#675](https://github.com/gjsify/gjsify/issues/675)) ([2ba84e3](https://github.com/gjsify/gjsify/commit/2ba84e33620b905f5e9abb790788646d70a084a2))
* **node-gi:** marshal GVariant build + unpack ([#654](https://github.com/gjsify/gjsify/issues/654)) ([5656cad](https://github.com/gjsify/gjsify/commit/5656cad44591acdd725e2c0f8f0a990e1fc045ba))
* **node-gi:** marshal JS functions as GI callbacks ([#644](https://github.com/gjsify/gjsify/issues/644)) ([f8dd452](https://github.com/gjsify/gjsify/commit/f8dd452a32cccc0386074ce6c2c887a12a75ec36))
* **node-gi:** marshal OUT and INOUT parameters ([#652](https://github.com/gjsify/gjsify/issues/652)) ([76351f2](https://github.com/gjsify/gjsify/commit/76351f227df14650b16d0cb4dad32c33d537e00f))
* **node-gi:** multi-level registered subclassing ([#669](https://github.com/gjsify/gjsify/issues/669)) ([2c2bcd1](https://github.com/gjsify/gjsify/commit/2c2bcd16cbf36fc052c194cbf78f93a1379d610b)), closes [#667](https://github.com/gjsify/gjsify/issues/667) [#668-review](https://github.com/gjsify/gjsify/issues/668-review)
* **node-gi:** override GObject vfuncs in registerClass ([#647](https://github.com/gjsify/gjsify/issues/647)) ([d2d2deb](https://github.com/gjsify/gjsify/commit/d2d2debe5a8e4eaa79e3bd0f3c468833995b602d))
* **node-gi:** register GObject subclasses ([#636](https://github.com/gjsify/gjsify/issues/636)) ([1e9bed4](https://github.com/gjsify/gjsify/commit/1e9bed4cab522fb9e66377c7520b28c8f8c0d88f))
* **node-gi:** registerClass mutate-in-place + ctor body ([#668](https://github.com/gjsify/gjsify/issues/668)) ([c64a87c](https://github.com/gjsify/gjsify/commit/c64a87ccbbfaaa3335574726ec507e5ad1d14fe3)), closes [#656](https://github.com/gjsify/gjsify/issues/656) [#667](https://github.com/gjsify/gjsify/issues/667) [#667](https://github.com/gjsify/gjsify/issues/667)
* **node-gi:** run a Gtk.Application on Node ([#659](https://github.com/gjsify/gjsify/issues/659)) ([47f4342](https://github.com/gjsify/gjsify/commit/47f4342a8fd1bc09fbe97f10270c661c77db61a2)), closes [#442](https://github.com/gjsify/gjsify/issues/442)
* **node-gi:** run an Adwaita app + CSS on Node ([#660](https://github.com/gjsify/gjsify/issues/660)) ([1c98a76](https://github.com/gjsify/gjsify/commit/1c98a7663eb4ca76cc1bc0f7387cc387a641b4d9))
* **node-gi:** run Gtk.Template composite widgets on Node ([#661](https://github.com/gjsify/gjsify/issues/661)) ([8dcd5ae](https://github.com/gjsify/gjsify/commit/8dcd5ae24415b504b1b7ce9ef20a78a1e43ad443)), closes [#659](https://github.com/gjsify/gjsify/issues/659) [#660](https://github.com/gjsify/gjsify/issues/660)
* **node-gi:** scaffold N-API GI engine + CI ([#629](https://github.com/gjsify/gjsify/issues/629)) ([85116c5](https://github.com/gjsify/gjsify/commit/85116c5f25c0284819edea631c0c1bf3a35feb0f))
* **node-gi:** seed GJS ambient globals on Node ([#645](https://github.com/gjsify/gjsify/issues/645)) ([7337db6](https://github.com/gjsify/gjsify/commit/7337db6260197409c3483b06211a06c52865919a))
* **node-gi:** signals (connect/emit/disconnect) ([#633](https://github.com/gjsify/gjsify/issues/633)) ([4106f88](https://github.com/gjsify/gjsify/commit/4106f885cc8b3d531d3c2300e289a5bc2cc04d18))
* **node-gi:** static methods + camelCase in L1 ([#640](https://github.com/gjsify/gjsify/issues/640)) ([94531e9](https://github.com/gjsify/gjsify/commit/94531e968e0a74e2203c11e407722ddd9185216e))
* **node-gi:** subclass custom props + signals ([#643](https://github.com/gjsify/gjsify/issues/643)) ([38084f8](https://github.com/gjsify/gjsify/commit/38084f8c5abe52e8f10023bd7c0a46b2d15b89a7))
* **node-gi:** support super.vfunc_* chain-up ([#663](https://github.com/gjsify/gjsify/issues/663)) ([e3fcae5](https://github.com/gjsify/gjsify/commit/e3fcae516ee47095d8b3a2209197ff0d4c7f9c62))
* **node-gi:** surface enums, flags + constants in L1 ([#638](https://github.com/gjsify/gjsify/issues/638)) ([b156c10](https://github.com/gjsify/gjsify/commit/b156c103b8dfa65ee8433209dbc53abdf38141d1))
* **node-gi:** surface GErrors as GLib.Error + Gio._promisify ([#657](https://github.com/gjsify/gjsify/issues/657)) ([3270c24](https://github.com/gjsify/gjsify/commit/3270c2476d0ad5a525bfc4708f7eec4707d9e0a6)), closes [#652](https://github.com/gjsify/gjsify/issues/652) [#656](https://github.com/gjsify/gjsify/issues/656)
* **node-gi:** toggle-ref instance GC bridge ([#656](https://github.com/gjsify/gjsify/issues/656)) ([d11941d](https://github.com/gjsify/gjsify/commit/d11941d7cc0bee502e6bf9aaa35b05953d386d9e)), closes [#647](https://github.com/gjsify/gjsify/issues/647)
* **node-gi:** value marshalling + function calls ([#631](https://github.com/gjsify/gjsify/issues/631)) ([529c447](https://github.com/gjsify/gjsify/commit/529c4477136713b9130614f9903aa2e3be45c5c5))
* route @girs/* through node-gi on --app node ([#673](https://github.com/gjsify/gjsify/issues/673)) ([f967d92](https://github.com/gjsify/gjsify/commit/f967d92ed0d3b36cd3ce1860715b714d8522d08a))
* route gi:// imports to node-gi on --app node ([#641](https://github.com/gjsify/gjsify/issues/641)) ([deb2322](https://github.com/gjsify/gjsify/commit/deb232257b8194bc932fc29a94d82b31e30853ae))

### Bug Fixes

* **cli:** preflight Node version for the native install backend ([#634](https://github.com/gjsify/gjsify/issues/634)) ([c5d47da](https://github.com/gjsify/gjsify/commit/c5d47da4e1604758b27d37ece056c9fe1216ba30))
* **cli:** skip workspace names in fetch queue ([#674](https://github.com/gjsify/gjsify/issues/674)) ([2b6d4c9](https://github.com/gjsify/gjsify/commit/2b6d4c99f00a1a11847c15e1c2348e64fbe00124))
* dedicated Soup-free CI classifier bundle ([#648](https://github.com/gjsify/gjsify/issues/648)) ([0f08700](https://github.com/gjsify/gjsify/commit/0f08700d73e62fa607572a43f6eca88b429b21bb))
* **nativescript-vite:** stable SBG chunk names ([#639](https://github.com/gjsify/gjsify/issues/639)) ([d1159f2](https://github.com/gjsify/gjsify/commit/d1159f24e28445384570f8cf92a0a9415f734675))
* **node-gi:** harden GI/GVariant marshalling ([#658](https://github.com/gjsify/gjsify/issues/658)) ([6e5fffb](https://github.com/gjsify/gjsify/commit/6e5fffb79b5a1baa8282d83f84f9a80707e3fb31)), closes [653/#654](https://github.com/653/gjsify/issues/654)
* **node-gi:** stabilize flaky GC test + plug leaks ([#664](https://github.com/gjsify/gjsify/issues/664)) ([867d72b](https://github.com/gjsify/gjsify/commit/867d72b8cf6e4ba4e19943243a38662a201f650b)), closes [658/#663](https://github.com/658/gjsify/issues/663)

### Documentation

* add Axis-5 GI/GObject-for-Node goal + roadmap ([#628](https://github.com/gjsify/gjsify/issues/628)) ([1479cbe](https://github.com/gjsify/gjsify/commit/1479cbe635e041287a9cc5f74f746b312a8abc14))

### Continuous Integration

* ignore node-gi in the affected classifier ([#646](https://github.com/gjsify/gjsify/issues/646)) ([4cab011](https://github.com/gjsify/gjsify/commit/4cab0117a305b1dc16b419d0aaba6a16b26c3d75))

## [0.13.1](https://github.com/gjsify/gjsify/compare/v0.13.0...v0.13.1) (2026-06-27)

### Bug Fixes

* **adwaita-nativescript:** normalize SVG arc flags for Android PathParser ([#627](https://github.com/gjsify/gjsify/issues/627)) ([1dd2d51](https://github.com/gjsify/gjsify/commit/1dd2d5197580b9025b781a2218edc54c6ccb4e7a))
* **nativescript-vite:** repoint mis-targeted @nativescript/core alias ([#626](https://github.com/gjsify/gjsify/issues/626)) ([a82ee80](https://github.com/gjsify/gjsify/commit/a82ee804f408017cb9e48e18709807dfdf8b91ed))

### Continuous Integration

* drop fedora 43, standardise on fedora 44 ([#625](https://github.com/gjsify/gjsify/issues/625)) ([fca4df7](https://github.com/gjsify/gjsify/commit/fca4df7dde73a347d3f543de9d1c0fb55b34a24f))
* run package type-check as a parallel job ([#624](https://github.com/gjsify/gjsify/issues/624)) ([f7bcf8d](https://github.com/gjsify/gjsify/commit/f7bcf8d18c5af918e304292c255d94336e0a8e32))

### Maintenance

* **refs:** register refs/gtk submodule ([921a965](https://github.com/gjsify/gjsify/commit/921a96543edc126cd8497a140fa695968af4f01b))

## [0.13.0](https://github.com/gjsify/gjsify/compare/v0.12.0...v0.13.0) (2026-06-27)

### Features

* **adwaita-nativescript:** add view stack, switcher bar, menu button ([#623](https://github.com/gjsify/gjsify/issues/623)) ([f5ba511](https://github.com/gjsify/gjsify/commit/f5ba5115d18912edff320735a2e7ba544b07391e))
* **adwaita-nativescript:** password-entry peek toggle ([#613](https://github.com/gjsify/gjsify/issues/613)) ([f200cce](https://github.com/gjsify/gjsify/commit/f200cce6d8c89c6c61db30f9cc8328ee05acf019))
* **adwaita-nativescript:** real symbolic icons + native-matching storybook chrome ([#611](https://github.com/gjsify/gjsify/issues/611)) ([ab0dab0](https://github.com/gjsify/gjsify/commit/ab0dab037a06672be104b83c455d50edab08ce2f))

### Bug Fixes

* **adwaita-nativescript:** declare native-platform dependency ([#609](https://github.com/gjsify/gjsify/issues/609)) ([5df0c2a](https://github.com/gjsify/gjsify/commit/5df0c2ad28d1f92196c82416b84af66980889fe2))

### Continuous Integration

* bake glib2/gettext/libatomic into CI image ([#608](https://github.com/gjsify/gjsify/issues/608)) ([d66fbed](https://github.com/gjsify/gjsify/commit/d66fbed79b469d4e49663752da685e0815b53533))
* build and type-check only the affected closure ([#614](https://github.com/gjsify/gjsify/issues/614)) ([d3ff78b](https://github.com/gjsify/gjsify/commit/d3ff78bf2068d58d7814ed1f817597136978c349))
* bump main.yml cache to v6 + slim CI image ([#619](https://github.com/gjsify/gjsify/issues/619)) ([9cbe433](https://github.com/gjsify/gjsify/commit/9cbe4331b3e356af75904d92f66cb96b2a89f061)), closes [#617](https://github.com/gjsify/gjsify/issues/617)
* bump to Node 26 + node24-runtime actions ([#617](https://github.com/gjsify/gjsify/issues/617)) ([7f85a82](https://github.com/gjsify/gjsify/commit/7f85a82a110540fa5313922b5112a70431565ac9)), closes [#614](https://github.com/gjsify/gjsify/issues/614)
* cache node_modules to skip install extract ([#612](https://github.com/gjsify/gjsify/issues/612)) ([fe4ffb7](https://github.com/gjsify/gjsify/commit/fe4ffb7516ebef5fc1af28eebc4b231f598d899f))
* consume prebuilt ci-fedora image, drop dnf ([#610](https://github.com/gjsify/gjsify/issues/610)) ([de24330](https://github.com/gjsify/gjsify/commit/de24330b61d9eb06b39afed3ac056134530deed9)), closes [#608](https://github.com/gjsify/gjsify/issues/608)
* shard the e2e suite across parallel jobs ([#622](https://github.com/gjsify/gjsify/issues/622)) ([9fa85c6](https://github.com/gjsify/gjsify/commit/9fa85c6ad7d00594b4400d8d095e4cc313e182db))
* split build/test/e2e/examples into parallel jobs ([#621](https://github.com/gjsify/gjsify/issues/621)) ([d7485e2](https://github.com/gjsify/gjsify/commit/d7485e2c7f2fdd37aaaa46564cdd6ed9df88fe2e))

## [0.12.0](https://github.com/gjsify/gjsify/compare/v0.11.0...v0.12.0) (2026-06-26)

### Features

* add Adwaita slider row + boxed-list rounding ([#606](https://github.com/gjsify/gjsify/issues/606)) ([92128c4](https://github.com/gjsify/gjsify/commit/92128c41024d4f06ba0efcd207d23b2395e76ddd))
* add browser storybook renderer and adwaita-web parity components ([#576](https://github.com/gjsify/gjsify/issues/576)) ([26079a6](https://github.com/gjsify/gjsify/commit/26079a6251d2a8781bced9e6e556b716cf71e1ab))
* add press feedback to NS Adwaita rows ([#604](https://github.com/gjsify/gjsify/issues/604)) ([b879f87](https://github.com/gjsify/gjsify/commit/b879f87ae228fc8f30fc639a8ae40e609809196e)), closes [#ffffff](https://github.com/gjsify/gjsify/issues/ffffff) [#ebebeb](https://github.com/gjsify/gjsify/issues/ebebeb) [#34343a](https://github.com/gjsify/gjsify/issues/34343a) [#44444a](https://github.com/gjsify/gjsify/issues/44444a) [#ffffff](https://github.com/gjsify/gjsify/issues/ffffff) [#ebebeb](https://github.com/gjsify/gjsify/issues/ebebeb)
* add the cdp MCP profile + `gjsify debug --profile cdp` ([#574](https://github.com/gjsify/gjsify/issues/574)) ([f723a25](https://github.com/gjsify/gjsify/commit/f723a25a151072ed79858a2cf3bf1acdae41bc96))
* adwaita storybook on nativescript ([#594](https://github.com/gjsify/gjsify/issues/594)) ([051479e](https://github.com/gjsify/gjsify/commit/051479ed8649e42f10e5a481c9ba6dfe9bb23cdb))
* **adwaita-storybook:** standard gjsify showcase + medium-width controls fold ([#588](https://github.com/gjsify/gjsify/issues/588)) ([7bcd7c6](https://github.com/gjsify/gjsify/commit/7bcd7c6bf1b1fa2fe4b21f74435d1b00ae93cb37))
* adwaita-web browser parity for showcases + components, devtools & webgl snapshot ([f24f215](https://github.com/gjsify/gjsify/commit/f24f215b4fe225781bf0415397f5a92442bf3984))
* **adwaita-web:** button, expander and password rows + entry-row pencil ([#580](https://github.com/gjsify/gjsify/issues/580)) ([968e69f](https://github.com/gjsify/gjsify/commit/968e69f6c1d019129dd531f3adffe43fe89f6de4))
* **adwaita-web:** buttons widgets and the remaining boxed-list rows ([#581](https://github.com/gjsify/gjsify/issues/581)) ([abe1578](https://github.com/gjsify/gjsify/commit/abe15783b8e430ee8121b1135a14b78dca200095))
* **adwaita-web:** complete the storybook port (layout, view switching, navigation, feedback) ([#582](https://github.com/gjsify/gjsify/issues/582)) ([900c23b](https://github.com/gjsify/gjsify/commit/900c23b3ff15883c311f7796128fb2a16160e1cb))
* **browse:** resizable window, one-shot --screenshot, and storybook driving tools ([#577](https://github.com/gjsify/gjsify/issues/577)) ([16e46b5](https://github.com/gjsify/gjsify/commit/16e46b5660387b4b594aae3cc17e2ee617ad565c))
* **devtools-cdp:** add WebKit Remote Inspector Protocol client ([#568](https://github.com/gjsify/gjsify/issues/568)) ([7938696](https://github.com/gjsify/gjsify/commit/7938696d8897254692b801bf3a410c3df0041a4e))
* **devtools-cdp:** expose the inspector protocol over the control plane ([#570](https://github.com/gjsify/gjsify/issues/570)) ([1ef200f](https://github.com/gjsify/gjsify/commit/1ef200fd3f5e93125a79cab28fcd2899e3d0a4c6))
* **devtools-cdp:** generate MCP tool descriptors from the protocol ([#571](https://github.com/gjsify/gjsify/issues/571)) ([af11825](https://github.com/gjsify/gjsify/commit/af11825299d292839f382165f0e3e215b74de3e1))
* native Adwaita icons for NS header buttons ([#605](https://github.com/gjsify/gjsify/issues/605)) ([d7dcf3f](https://github.com/gjsify/gjsify/commit/d7dcf3f9991d74c924d67b3a6ec5e6766c10f81c))
* native Adwaita widgets + devtools for NativeScript ([#592](https://github.com/gjsify/gjsify/issues/592)) ([0b2f255](https://github.com/gjsify/gjsify/commit/0b2f25549bedc3ba1ef3e7ea1e8d61f903886145))
* render coverage dashboards with adwaita-web (single chevron, GNOME HIG) ([#587](https://github.com/gjsify/gjsify/issues/587)) ([72351a4](https://github.com/gjsify/gjsify/commit/72351a44500dc0580a0b7ab3fc6213d50f8d5a75))
* render NS combo-row chevron via AdwIcon ([#607](https://github.com/gjsify/gjsify/issues/607)) ([492a98a](https://github.com/gjsify/gjsify/commit/492a98a93f792b407696894f191932ae44727308)), closes [#605](https://github.com/gjsify/gjsify/issues/605)
* single-header master-detail NS storybook layout ([#598](https://github.com/gjsify/gjsify/issues/598)) ([96a7ede](https://github.com/gjsify/gjsify/commit/96a7ede5c949193134cd538f549157899cc89bb5))
* **storybook:** add Adwaita storybook showcase ([878f8db](https://github.com/gjsify/gjsify/commit/878f8db079ae0e652b6f45222d88d82cd27e0245))
* **storybook:** outline the story preview stage ([abfc275](https://github.com/gjsify/gjsify/commit/abfc275a38c477c4b66f6d4d6b7ec0123e8077db))
* **website:** declutter the home page into documentation subpages ([#586](https://github.com/gjsify/gjsify/issues/586)) ([364b544](https://github.com/gjsify/gjsify/commit/364b5448486ffa5ec025f62b04b93d8a20b9df66))

### Bug Fixes

* **adwaita-storybook:** keep storybook controls closed at embed widths (+ slide copy) ([#589](https://github.com/gjsify/gjsify/issues/589)) ([b3d6973](https://github.com/gjsify/gjsify/commit/b3d6973a55fb189c5f428757f2fcdfd11596cc72))
* **adwaita-web:** match native colours for spinner, banner, avatar + group title ([#579](https://github.com/gjsify/gjsify/issues/579)) ([cdd354b](https://github.com/gjsify/gjsify/commit/cdd354bfcb6a0852e59a744be018faea8a31fbbf))
* **child_process:** capture pid at spawn before reap ([#596](https://github.com/gjsify/gjsify/issues/596)) ([c476fcd](https://github.com/gjsify/gjsify/commit/c476fcd18e4f596b360345f01e1d2568373dbe5f)), closes [GNOME/glib#3981](https://github.com/GNOME/glib/issues/3981) [GNOME/glib#1866](https://github.com/GNOME/glib/issues/1866)
* **child_process:** emit 'spawn' via microtask, not setTimeout(0) ([c77fd30](https://github.com/gjsify/gjsify/commit/c77fd3090b86b5e21db1cebeb801f9b726605f0b))
* **cli:** clean error and exit 1 on CLI rejection ([#602](https://github.com/gjsify/gjsify/issues/602)) ([6e054b2](https://github.com/gjsify/gjsify/commit/6e054b2593cd9ed084549effd819682082de5463))
* **cli:** gjsify tsc — degrade to upstream tsc when gjs is absent (was exit 254) ([#595](https://github.com/gjsify/gjsify/issues/595)) ([fb582eb](https://github.com/gjsify/gjsify/commit/fb582eb212863ff883876d8857bc5d8b8a84704d))
* **cli:** skip re-extracting unchanged packages on install ([#590](https://github.com/gjsify/gjsify/issues/590)) ([8d6b7e6](https://github.com/gjsify/gjsify/commit/8d6b7e673ae1809956734bd7422fac6b3d915d8c))
* converge the native and web Adwaita storybooks (backgrounds, separators, responsive) ([#578](https://github.com/gjsify/gjsify/issues/578)) ([69dc920](https://github.com/gjsify/gjsify/commit/69dc92021c2cb4516ce4ef5a018d66f6e4c9baba))
* **devtools-browser:** republish 0.11.1 with built lib (0.11.0 shipped empty) ([0244b77](https://github.com/gjsify/gjsify/commit/0244b7751d5267c9d367cdb85148d0a911e71655))
* **devtools:** retry Screenshot until renderable ([f5916eb](https://github.com/gjsify/gjsify/commit/f5916eb8a47226274d1a350f8a96ced24aadb07a))
* **nativescript-vite:** support @nativescript/vite 8 + stub peers ([#591](https://github.com/gjsify/gjsify/issues/591)) ([2dd87e1](https://github.com/gjsify/gjsify/commit/2dd87e17c53f8e0d7052b60d553475339fbff8ce))
* **stories:** resolve from source for browser bundlers so the docs site builds ([#585](https://github.com/gjsify/gjsify/issues/585)) ([20a2284](https://github.com/gjsify/gjsify/commit/20a22848a0ae35ac640b6e872b802a63c7337047))
* **tsc:** write the bundle atomically to avoid a concurrent-read race ([#572](https://github.com/gjsify/gjsify/issues/572)) ([5dda200](https://github.com/gjsify/gjsify/commit/5dda2009beeb33c046b37d8694a53dbeabf31b9b))
* **unit:** attribute failures to the running it() ([#593](https://github.com/gjsify/gjsify/issues/593)) ([5ec97d1](https://github.com/gjsify/gjsify/commit/5ec97d1b9ec38e052b6dc349d79aa4a14868e1a3))
* **website:** build @gjsify/stories before the docs build ([#584](https://github.com/gjsify/gjsify/issues/584)) ([a045329](https://github.com/gjsify/gjsify/commit/a04532913cbb0a3cd14322bd8532263555436815))

### Continuous Integration

* test on Node 26 + runtime-labeled unit summaries ([#601](https://github.com/gjsify/gjsify/issues/601)) ([ca7d393](https://github.com/gjsify/gjsify/commit/ca7d39351dc8d454ea77d4631715fb42c5c79b61))

### Maintenance

* **refs:** update all submodules to latest ([74a162c](https://github.com/gjsify/gjsify/commit/74a162cebfddc51bf1395927ecd34a3e1c2dde07))

### Tests

* **devtools-cdp:** live-inspector suite + set the inspector env in the browse launcher ([#575](https://github.com/gjsify/gjsify/issues/575)) ([3a6b44d](https://github.com/gjsify/gjsify/commit/3a6b44d22d3d810f70c46b2ff7847e4f05fc8f56))
* **tls:** gjs-scope IPv6 IP-SAN check (native node regression) ([#600](https://github.com/gjsify/gjsify/issues/600)) ([0c1f204](https://github.com/gjsify/gjsify/commit/0c1f204bdc594d014e9b90afbb01685cdd625730))

## [0.11.0](https://github.com/gjsify/gjsify/compare/v0.10.0...v0.11.0) (2026-06-22)

### Features

* **devtools-browser:** MCP-drivable Adwaita web browser ([#566](https://github.com/gjsify/gjsify/issues/566)) ([5537592](https://github.com/gjsify/gjsify/commit/55375924f9cb9ef484db2459bead7bf21d182018))
* **devtools:** add DBus + MCP debug control plane ([6228c53](https://github.com/gjsify/gjsify/commit/6228c53fad07825d0e5c9ecee5cd1ed970d5492d))
* **iframe:** add page eval, screenshot, nav-wait ([98e3915](https://github.com/gjsify/gjsify/commit/98e3915161f634fe4399abf18cd359a50b7f5bf7))
* **iframe:** console capture + DOM helpers ([f15b6c9](https://github.com/gjsify/gjsify/commit/f15b6c9cf7b6c2593ca0cb5b92b53fcd8d989bb9))
* warn on GI-backed --globals auto injection ([9a83f19](https://github.com/gjsify/gjsify/commit/9a83f1935b867f592923e109c817bf63a3ee26ac))

### Bug Fixes

* **cli:** honor config globals over yargs default ([63cae36](https://github.com/gjsify/gjsify/commit/63cae36f374182cc36e587279832bc26b87c9e1c)), closes [package.json#gjsify](https://github.com/gjsify/package.json/issues/gjsify)
* **devtools-mcp:** align zod range to ^4.4.3 ([e65587a](https://github.com/gjsify/gjsify/commit/e65587a9f0d9984063b1db7bc09de771fb1557ca)), closes [#557](https://github.com/gjsify/gjsify/issues/557)

### Documentation

* document devtools control plane + debug/browse/storybook CLI ([#567](https://github.com/gjsify/gjsify/issues/567)) ([1839953](https://github.com/gjsify/gjsify/commit/183995334a90ff294fd3b4026290cd99511133ac))

### Continuous Integration

* raise nofile limit to fix F43 test EMFILE ([f02a1f4](https://github.com/gjsify/gjsify/commit/f02a1f466797cd20a03504a7fdf72b311dc82c59))
* raise testuser nofile limit for F43 tests ([a3c1938](https://github.com/gjsify/gjsify/commit/a3c19381f26f92827c5ce21254e795fa1967cef7))

### Maintenance

* **refs:** Add GNOME HIG ([74e17cc](https://github.com/gjsify/gjsify/commit/74e17cc10e7a5f57ca00f176b247b083a0701e70))
* **refs:** update submodules to latest upstream ([e67efe1](https://github.com/gjsify/gjsify/commit/e67efe1f6daee0fbe2aa6d4019b967d8e70f8091)), closes [#277](https://github.com/gjsify/gjsify/issues/277)

## [0.10.0](https://github.com/gjsify/gjsify/compare/v0.9.0...v0.10.0) (2026-06-21)

### Features

* node-free multi-package orchestration under GJS ([#558](https://github.com/gjsify/gjsify/issues/558)) ([eb4f6b2](https://github.com/gjsify/gjsify/commit/eb4f6b2b46e6a21764962308e7cd27e19a5401fd))

## [0.9.0](https://github.com/gjsify/gjsify/compare/v0.8.0...v0.9.0) (2026-06-21)

### Features

* auto-bundle by-name plugins under GJS ([#556](https://github.com/gjsify/gjsify/issues/556)) ([e14c99c](https://github.com/gjsify/gjsify/commit/e14c99cf14dc63e594926d181b0b9aab308ee912))

### Bug Fixes

* **e2e:** move self-host to the serial e2e tail ([1f64043](https://github.com/gjsify/gjsify/commit/1f640434edf2fb1ff3c135b4a55265974b0695a1))
* **workspace:** dedupe overlapping workspace globs ([#555](https://github.com/gjsify/gjsify/issues/555)) ([f6230b9](https://github.com/gjsify/gjsify/commit/f6230b94f22e51ffbd5361faa23d3e903437424c))

## [0.8.0](https://github.com/gjsify/gjsify/compare/v0.7.5...v0.8.0) (2026-06-20)

### Features

* add @gjsify/storybook + @gjsify/stories ([#551](https://github.com/gjsify/gjsify/issues/551)) ([76812a2](https://github.com/gjsify/gjsify/commit/76812a20533f17547e9c0597573356b65b0f2a7e))

### Bug Fixes

* robust gjsify login prompt (raw-mode rework) ([#553](https://github.com/gjsify/gjsify/issues/553)) ([b81a181](https://github.com/gjsify/gjsify/commit/b81a181e6205c530099a03675db805f303117e7c))

### Build System

* bootstrap process with -d so string_decoder builds first ([9f03b0b](https://github.com/gjsify/gjsify/commit/9f03b0bf58ecf15ce5dee812f6c758fabd3a2ee8))
* exclude specs from buffer/string_decoder tsc ([2059710](https://github.com/gjsify/gjsify/commit/20597102b756de48a231a6c105b961d2f05c063b))

## [0.7.5](https://github.com/gjsify/gjsify/compare/v0.7.4...v0.7.5) (2026-06-19)

### Bug Fixes

* **process:** setEncoding emits decoded strings (Node contract) ([24d87a3](https://github.com/gjsify/gjsify/commit/24d87a314a41af595aee7ac45fdbc0cfc92bd7be)), closes [#546](https://github.com/gjsify/gjsify/issues/546)
* **unit:** throw matchers don't leak fail count ([#547](https://github.com/gjsify/gjsify/issues/547)) ([33e5604](https://github.com/gjsify/gjsify/commit/33e5604eada452f68aa86ce11ca325cf00017ce9))

### Documentation

* make STATUS.md a current snapshot, drop the append-log ([#548](https://github.com/gjsify/gjsify/issues/548)) ([7c8a945](https://github.com/gjsify/gjsify/commit/7c8a945dd89eb62cfd69da2ed3399bb9cc4133ac))

## [0.7.4](https://github.com/gjsify/gjsify/compare/v0.7.3...v0.7.4) (2026-06-19)

### Features

* **unit:** vitest compatibility (vi, toMatchObject, async matchers, more) ([#544](https://github.com/gjsify/gjsify/issues/544)) ([8d566c8](https://github.com/gjsify/gjsify/commit/8d566c800eb7851d6c73095ae0d325f8e24bba30))

### Bug Fixes

* **cli:** `gjsify run` forwards unknown --flags to the child without `--` ([#541](https://github.com/gjsify/gjsify/issues/541)) ([77884b6](https://github.com/gjsify/gjsify/commit/77884b60ebfa906eabfb62c500da33e16a716445))
* **cli:** gjsify install preserves the lockfile ([#543](https://github.com/gjsify/gjsify/issues/543)) ([28408fb](https://github.com/gjsify/gjsify/commit/28408fbf698ddda608e4538a1dc27b8c41acb7f1)), closes [#537](https://github.com/gjsify/gjsify/issues/537)
* **cli:** gjsify login password prompt submits on Enter under GJS ([#546](https://github.com/gjsify/gjsify/issues/546)) ([45a4777](https://github.com/gjsify/gjsify/commit/45a4777e65153c64bf253027b55623a6a715b7ea))
* **cli:** retry transient OIDC 5xx + fail loudly without a token ([#542](https://github.com/gjsify/gjsify/issues/542)) ([1b25b25](https://github.com/gjsify/gjsify/commit/1b25b254ee90a2f13df3dbb2349f02557441bda3))

### Documentation

* anchor the version-bumper + repair rewritten history ([#545](https://github.com/gjsify/gjsify/issues/545)) ([9a4141e](https://github.com/gjsify/gjsify/commit/9a4141ed7c5a96d2fd290cefa1d04e111fb081ab))

### Continuous Integration

* **affected:** walk production deps only in the closure ([#539](https://github.com/gjsify/gjsify/issues/539)) ([9450744](https://github.com/gjsify/gjsify/commit/9450744d6d7525fb4cddbb570b9d67efa0b4953d))

## [0.7.3](https://github.com/gjsify/gjsify/compare/v0.7.2...v0.7.3) (2026-06-18)

### Features

* **cli:** add progress bar to gjsify self-update ([0af3876](https://github.com/gjsify/gjsify/commit/0af3876189eb183bbe0d09411c2f1355d0a0e811))
* support `using`/Symbol.dispose on GJS ([#537](https://github.com/gjsify/gjsify/issues/537)) ([194d686](https://github.com/gjsify/gjsify/commit/194d68646f0f36d929ea15e32bfad0bdffd2f5ee))

### Bug Fixes

* **sqlite:** comment-aware exec() splitter ([#536](https://github.com/gjsify/gjsify/issues/536)) ([9fff06e](https://github.com/gjsify/gjsify/commit/9fff06efbc9be4280cd916d01985ff443026cd5c))

### Continuous Integration

* scope, parallelize and cache the PR pipeline ([#538](https://github.com/gjsify/gjsify/issues/538)) ([4250886](https://github.com/gjsify/gjsify/commit/4250886cc9e566a2e2da8fea93abb1f25fa27933))

## [0.7.2](https://github.com/gjsify/gjsify/compare/v0.7.1...v0.7.2) (2026-06-17)

### Bug Fixes

* **trust:** send required `permissions` in the trust POST body ([#533](https://github.com/gjsify/gjsify/issues/533)) ([3f0df4c](https://github.com/gjsify/gjsify/commit/3f0df4cca50296afece047aa555c03f963f41de6))
* **trust:** try without OTP first + accept CR-terminated prompt input ([#534](https://github.com/gjsify/gjsify/issues/534)) ([539ace9](https://github.com/gjsify/gjsify/commit/539ace9ae113b663f647e68011f902fec7bece7c))

## [0.7.1](https://github.com/gjsify/gjsify/compare/v0.7.0...v0.7.1) (2026-06-17)

### Features

* **cli:** add native `gjsify trust` command for npm Trusted Publishers ([#532](https://github.com/gjsify/gjsify/issues/532)) ([6e420a9](https://github.com/gjsify/gjsify/commit/6e420a9edc5d6dc2471ed0381ab2f4e547d15599))

### Bug Fixes

* **install:** wire workspace symlinks before the download phase ([#529](https://github.com/gjsify/gjsify/issues/529)) ([6bcc115](https://github.com/gjsify/gjsify/commit/6bcc115fc775298aa2759c4a21a42d9929faf736))

### Tests

* **nativescript:** add stream + native-platform on-device smoke specs ([#530](https://github.com/gjsify/gjsify/issues/530)) ([22dc556](https://github.com/gjsify/gjsify/commit/22dc5563c76bf099bfc100683580b23da544593d))

## [0.7.0](https://github.com/gjsify/gjsify/compare/v0.6.1...v0.7.0) (2026-06-16)

### Features

* **native-platform:** add NativeScript platform detection package ([#528](https://github.com/gjsify/gjsify/issues/528)) ([3f9a987](https://github.com/gjsify/gjsify/commit/3f9a987d2087a10c76130b1430ff1f53fa9a4db2)), closes [#525](https://github.com/gjsify/gjsify/issues/525)

## [0.6.1](https://github.com/gjsify/gjsify/compare/v0.6.0...v0.6.1) (2026-06-16)

### Code Refactoring

* dedupe NativeScript crypto/fs-bridge code, add crypto NS tests ([#527](https://github.com/gjsify/gjsify/issues/527)) ([04c1938](https://github.com/gjsify/gjsify/commit/04c1938270f5843e0f077e4ff02ca5329ad34b54))

## [0.6.0](https://github.com/gjsify/gjsify/compare/v0.5.2...v0.6.0) (2026-06-16)

### Features

* **crypto:** add @noble/hashes fallback for NativeScript (no GLib.Checksum/crypto.subtle) ([#526](https://github.com/gjsify/gjsify/issues/526)) ([db58d59](https://github.com/gjsify/gjsify/commit/db58d597b24c30854467baca8c3b25786a6699e5))
* **native-fs-bridge:** welle 5-B — add @gjsify/native-fs-bridge package ([#525](https://github.com/gjsify/gjsify/issues/525)) ([840cf1f](https://github.com/gjsify/gjsify/commit/840cf1f008e91f60db9730a343711dad55e9d9e6))

### Documentation

* **status:** strike stale BLOCKER entries — all 3 packages already on npm ([#523](https://github.com/gjsify/gjsify/issues/523)) ([208ab14](https://github.com/gjsify/gjsify/commit/208ab14e835def654436bd7736e7e33d039c255b))

### Maintenance

* **lint:** clear remaining consistent-type-imports warnings ([#524](https://github.com/gjsify/gjsify/issues/524)) ([96d59d7](https://github.com/gjsify/gjsify/commit/96d59d743a889b946b0eb84566af942cadc04b03))

## [0.5.2](https://github.com/gjsify/gjsify/compare/v0.5.1...v0.5.2) (2026-06-16)

### Bug Fixes

* **cli:** walk parent dirs to find rolldown-native from subdir cwd ([#522](https://github.com/gjsify/gjsify/issues/522)) ([b047439](https://github.com/gjsify/gjsify/commit/b04743909dbb443f556b7bc49f7ff475a1044467))
* **fetch:** buffer body before gzip decompress to avoid G_IO_ERROR_PARTIAL_INPUT ([#519](https://github.com/gjsify/gjsify/issues/519)) ([72e33cf](https://github.com/gjsify/gjsify/commit/72e33cfddafbe26493201fb46966135817862876))
* **webgl:** colorSpace default, FBO detach docs, cache MAX_RENDERBUFFER_SIZE ([#521](https://github.com/gjsify/gjsify/issues/521)) ([a5e9d88](https://github.com/gjsify/gjsify/commit/a5e9d88312bc8577b1b0c32141617ed8d647212a))

### Documentation

* **status:** mark zlib Zstd stubs done (PR [#404](https://github.com/gjsify/gjsify/issues/404)) ([#520](https://github.com/gjsify/gjsify/issues/520)) ([3ebec45](https://github.com/gjsify/gjsify/commit/3ebec456e63fb608b406c03c87ea8d087e513298))

## [0.5.1](https://github.com/gjsify/gjsify/compare/v0.5.0...v0.5.1) (2026-06-15)

### Bug Fixes

* **publish:** send npm-command header for new-package PUT ([ffd5a2a](https://github.com/gjsify/gjsify/commit/ffd5a2a9c9b85e545bc8b5378fea5bb8185c7162))

### Build System

* **cli:** reconcile bundle with publish-headers fix ([#518](https://github.com/gjsify/gjsify/issues/518)) ([6b9e606](https://github.com/gjsify/gjsify/commit/6b9e6064beddceb580711dc126d1bf1c04be07b6))

## [0.5.0](https://github.com/gjsify/gjsify/compare/v0.4.46...v0.5.0) (2026-06-14)

### Features

* **publish:** surface npm 401 body + decoded JWT claims in --check-trusted ([344b6c2](https://github.com/gjsify/gjsify/commit/344b6c22a5fb19634dda0a9cd1a86c464ab7b81b))

### Bug Fixes

* **auto-globals:** skip unresolvable register imports ([053b825](https://github.com/gjsify/gjsify/commit/053b825c3898ef80d953a5039a7e881518506fa4))
* **auto-globals:** wire cwd gate into build + STATUS ([2d3b642](https://github.com/gjsify/gjsify/commit/2d3b64237dff1ef457e21ccbd37e53a0d65a909c))
* **cli:** clear error for `build` under GJS bundle ([c4ed9fb](https://github.com/gjsify/gjsify/commit/c4ed9fb019f8ad8e8f245bab71a1b5835631ff56))
* **cli:** rebuild bundle + STATUS for run stdio fix ([40e0a2d](https://github.com/gjsify/gjsify/commit/40e0a2d231c237d70ddbb1159578d227e522304b))
* **cli:** rebuild bundle with [#514](https://github.com/gjsify/gjsify/issues/514) auto-globals (build-order) ([089d75a](https://github.com/gjsify/gjsify/commit/089d75aa90c15247f89cc5364ec6729251dc0770))
* **cli:** send run banner to stderr, forward -- args ([0368b80](https://github.com/gjsify/gjsify/commit/0368b80cf8722e0a0e06ffce2670c22bf9581c52))
* **compression-streams:** decode multi-chunk input ([9b88efa](https://github.com/gjsify/gjsify/commit/9b88efa686ad8c073942f4d462d9a73e5700c642))
* **process:** auto-resume ProcessReadStream on 'data' listener ([ffb720a](https://github.com/gjsify/gjsify/commit/ffb720ac9796a0897ca8cf4aa99bc7e7024d10ae))
* **publish:** send OIDC audience via string concat, not URL.searchParams ([b175c1d](https://github.com/gjsify/gjsify/commit/b175c1d5db315009b8da51801083c921a2944ec1))
* **release:** npm trust needs --allow-publish; npx fallback for old npm ([ecfcb9f](https://github.com/gjsify/gjsify/commit/ecfcb9fc94a0f370fa645beb6ba64b9ca976b88d))
* **zlib:** add streaming codec classes for GJS ([5bbad3a](https://github.com/gjsify/gjsify/commit/5bbad3a1657883d85328762e804f5df57741e27d))
* **zlib:** pipeThrough web (de)compress to stop GJS rejection leak ([6d33a85](https://github.com/gjsify/gjsify/commit/6d33a850bbc74c8f273bea7bf29a3d21e1b0b45d))
* **zlib:** silence writer teardown rejection on GJS ([9dfa7a6](https://github.com/gjsify/gjsify/commit/9dfa7a6bea6bc5efbacd5b5b7fa5c627c868bea7))

### Reverts

* **cli:** drop [#510](https://github.com/gjsify/gjsify/issues/510) GJS build guard — it broke the Node-free release build ([92dde1b](https://github.com/gjsify/gjsify/commit/92dde1bfc3e6c1b6127e4e08a584d28e83fa8f4a)), closes [#483](https://github.com/gjsify/gjsify/issues/483)

### Documentation

* **gjs:** analyse TLA + main-loop exit deadlock ([4856b93](https://github.com/gjsify/gjsify/commit/4856b939a308aadab75f692103fd17b22e53074f))
* **status:** note gjsify-build-under-GJS guard ([#510](https://github.com/gjsify/gjsify/issues/510)) ([80f95b0](https://github.com/gjsify/gjsify/commit/80f95b01e85eb2ec09f82a8382a4b35b5ca21abf))

### Build System

* **cli:** reconcile bundle with [#516](https://github.com/gjsify/gjsify/issues/516) zlib pipeThrough web (de)compress ([b3c56c2](https://github.com/gjsify/gjsify/commit/b3c56c200f89fb02bcc26c6a71db394043426279))

### Continuous Integration

* probe @gjsify/cli OIDC exchange with lowercase %2f ([15d79e2](https://github.com/gjsify/gjsify/commit/15d79e2f083f633a5ceb53fac42e3a77e42cc90a))
* remove temp OIDC debug scaffolding (audience bug fixed) ([c265bb8](https://github.com/gjsify/gjsify/commit/c265bb80e79ce98309077fd5ef93ce633702342c))
* temp OIDC debug workflow (dump JWT issuer/claims + exchange probe) ([977501b](https://github.com/gjsify/gjsify/commit/977501b90aed1ab8a8bc17ebc2584ab16847c500))
* temp raw-curl OIDC probe in release.yml (verify_only) ([a5cdfd7](https://github.com/gjsify/gjsify/commit/a5cdfd7e571d0e1ac760c2026e1f0de52e385617))

### Maintenance

* **release:** add bulk npm Trusted Publisher config script ([52960ef](https://github.com/gjsify/gjsify/commit/52960ef9b1f824cd9b60a8166a3ca4c77875f16b))

### Tests

* **zlib:** repro streaming gunzip concat members ([d66ef5d](https://github.com/gjsify/gjsify/commit/d66ef5da518fcf7b1ebcf5079567ad75797dd972)), closes [#508](https://github.com/gjsify/gjsify/issues/508) [#508](https://github.com/gjsify/gjsify/issues/508)

## [0.4.46](https://github.com/gjsify/gjsify/compare/v0.4.45...v0.4.46) (2026-06-14)

### Bug Fixes

* **fetch:** preserve %2F in URL paths under GJS (UriFlags.ENCODED) ([3596e53](https://github.com/gjsify/gjsify/commit/3596e53b6118dabd948a93f72c8674833f976fa7))

## [0.4.45](https://github.com/gjsify/gjsify/compare/v0.4.44...v0.4.45) (2026-06-13)

### Features

* **cli:** dispatch single gjsify-command scripts in-process under GJS ([2ac6d17](https://github.com/gjsify/gjsify/commit/2ac6d1712e6112067bc9ff3b0575e873b54c9f0e))
* **cli:** gjs-first bin-shim default ([87855d9](https://github.com/gjsify/gjsify/commit/87855d9bcebc573f09ebce4523cb89834f664008))
* **cli:** gjsify tsc Node fallback (npm typescript) ([694e7a3](https://github.com/gjsify/gjsify/commit/694e7a31dc06327c345237eeda1fc54d0ce3bc9f))
* **cli:** node-free gjsify format under gjs ([ebae533](https://github.com/gjsify/gjsify/commit/ebae533fd751d45e283933b013a80b70916bdae3))
* **flatpak:** gjsify SDK extension ([50600ef](https://github.com/gjsify/gjsify/commit/50600efddb81f3a6cec6cccbf22c1b0d6c3f0dfc))
* **flatpak:** ship tsc + multi-arch in SDK extension ([0003001](https://github.com/gjsify/gjsify/commit/00030012f8f8c0784acd117b8d8610514e344ecc))
* **oxfmt-native:** in-process oxfmt cli run() ([068cfef](https://github.com/gjsify/gjsify/commit/068cfef31a0b022b659aa3735f41cc60fda57c76))
* **oxfmt-native:** node-free oxc formatter as a GI bridge ([4759142](https://github.com/gjsify/gjsify/commit/4759142acd1ad466cdc96653f0b5769483a593a4))

### Bug Fixes

* **cli:** buffer foreach output on non-tty to avoid gjs hang ([f64f82a](https://github.com/gjsify/gjsify/commit/f64f82a4cec999da084792be8575b2c9d42f6872))
* **cli:** dual-anchor @gjsify/tsc resolution ([53af6c8](https://github.com/gjsify/gjsify/commit/53af6c865d750a762caec11c6710dce4f29f279b))
* **cli:** exit gjsify run file path after child success ([85d9ba8](https://github.com/gjsify/gjsify/commit/85d9ba8f0edda1253b018e64b5537ec6ae71ab67))
* **cli:** exit semantics + check backpressure + foreach args ([dacdec3](https://github.com/gjsify/gjsify/commit/dacdec3ea3f5d3eaf6c3cab82c403a130130987b))
* **cli:** foreach fail-fasts on child failure (no GJS hang) ([a8ed79a](https://github.com/gjsify/gjsify/commit/a8ed79ac8bf794cc466325673013ecf457681d7a))
* **cli:** kill children on foreach fail-fast ([7e39023](https://github.com/gjsify/gjsify/commit/7e3902300abb75d60966fc771a67336968ead6e7)), closes [#497](https://github.com/gjsify/gjsify/issues/497)
* **cli:** kill the whole process tree on fail-fast ([8002ec0](https://github.com/gjsify/gjsify/commit/8002ec0f4c390d7e3da39b3e39043f1a424e38af))
* **cli:** native rolldown options serialization ([7c03c0b](https://github.com/gjsify/gjsify/commit/7c03c0bb79a080c150b4b42d6ae897895a6f8371))
* **cli:** stall watchdog + live progress in foreach -tp ([013a7ec](https://github.com/gjsify/gjsify/commit/013a7ecbeacd041d78437eead7d47656ac36f150))
* **cli:** write bin shims before download phase ([d669159](https://github.com/gjsify/gjsify/commit/d6691593479235eb8fab656e9b0e75764efba2ee)), closes [#489](https://github.com/gjsify/gjsify/issues/489)
* **rolldown-native:** keep session alive during build ([47ff5ad](https://github.com/gjsify/gjsify/commit/47ff5adecf0c9c74ccf07d659e42ff96c322bcee)), closes [#501](https://github.com/gjsify/gjsify/issues/501) [#501](https://github.com/gjsify/gjsify/issues/501)
* **rolldown-native:** session teardown + closure-generator bypass ([47b9ba6](https://github.com/gjsify/gjsify/commit/47b9ba6d0ee453fcfcaf505dd28f3edcd3118d78))
* **rolldown-plugin-gjsify:** externalize lib deps via resolveId ([1fb4ab4](https://github.com/gjsify/gjsify/commit/1fb4ab4437fe4b014db242f61dc2ef4a6c231f59)), closes [#487](https://github.com/gjsify/gjsify/issues/487)
* **rolldown-plugin-gjsify:** externalize node-target deps as array for native rolldown ([78a6042](https://github.com/gjsify/gjsify/commit/78a6042ac1ac44d994b44aa45dc4436505c4cb3a))
* **rolldown-plugin-gjsify:** file://-resolve lightningcss-native under GJS ([efe6a9f](https://github.com/gjsify/gjsify/commit/efe6a9fd30809b6ba022daaa3acf8bc116bd16a3))
* **tsc:** bundle via the workspace node cli, not PATH ([857e347](https://github.com/gjsify/gjsify/commit/857e347424ad867475598e52006aad764e9d83a1))
* **tsc:** keep complete committed libs (no parallel-build refresh race) ([7680ede](https://github.com/gjsify/gjsify/commit/7680ede03e2f5b3bf9afe5a0d8d4becd46910e88))
* **zlib:** declare @gjsify/stream as runtime dep ([6912c65](https://github.com/gjsify/gjsify/commit/6912c6523ae5c0990ba63c1475cfc2ff8747b17b))

### Performance Improvements

* **rolldown-plugin-gjsify:** single-detection --globals auto via closure map ([d7f5599](https://github.com/gjsify/gjsify/commit/d7f5599f080ded9a1287cf034419095ed41c7f99))

### Documentation

* oxfmt-native bridge + dual-engine format ([3d173dd](https://github.com/gjsify/gjsify/commit/3d173ddb977d1eb6bb001b65f33675cf648341b8))
* **status:** link upstream GLib issue [#3981](https://github.com/gjsify/gjsify/issues/3981) for the pid gap ([b08afe1](https://github.com/gjsify/gjsify/commit/b08afe1eef7ab1e2fc1d062432bd3dd837dadab3)), closes [#503](https://github.com/gjsify/gjsify/issues/503)

### Build System

* bootstrap native facades in build:infra ([ce4e660](https://github.com/gjsify/gjsify/commit/ce4e66099e56f0e8ac449e810d20350bdc8386f9))
* **cli:** rebuild gjs bundle on rebased base ([25afc18](https://github.com/gjsify/gjsify/commit/25afc18e001797018bf5ed124af7bf9010385962))

### Continuous Integration

* **affected:** ignore flatpak/ build tooling ([c6cc6c7](https://github.com/gjsify/gjsify/commit/c6cc6c753079bfdd3a8c5424877d70f18af13dca))
* cap GJS build job + Build-examples step timeouts ([4b1162a](https://github.com/gjsify/gjsify/commit/4b1162a2a495963563045fd4bdde875f10249049))
* raise job cap for cold gjs builds ([a6c4d34](https://github.com/gjsify/gjsify/commit/a6c4d34a49a5f6520c3c8f2677c7212047ad23b6))
* serialize gjs examples build to avoid oom stall ([8fd806b](https://github.com/gjsify/gjsify/commit/8fd806b7398cef31e4d676b19f96771be10f050c))

### Maintenance

* **deps:** upgrade dependencies to latest ([880d28b](https://github.com/gjsify/gjsify/commit/880d28b447d0daa3429222e93b9fc40ff11f8b6b))
* **rolldown-native:** rebuild linux-x86_64 prebuild ([727fee8](https://github.com/gjsify/gjsify/commit/727fee834f6a70f6fdddc0c5af1666e10eadbbbc)), closes [#501](https://github.com/gjsify/gjsify/issues/501)
* update native prebuilds [skip ci] ([746b007](https://github.com/gjsify/gjsify/commit/746b0074ca350f0021150550c1f633c1540986e4))
* update native prebuilds [skip ci] ([0102bbd](https://github.com/gjsify/gjsify/commit/0102bbd162247bde482f540d6305ad259f5cb192))

### Tests

* **child_process:** de-flake spawn-event under CI saturation ([4137266](https://github.com/gjsify/gjsify/commit/4137266ff04fae50bbef6e3890c5a72e8fee0acd)), closes [post-#502](https://github.com/gjsify/post-/issues/502) [#503](https://github.com/gjsify/gjsify/issues/503)
* **child_process:** make pid test deterministic ([52f1c95](https://github.com/gjsify/gjsify/commit/52f1c9527f80559a4a65c21e48179df9755394c5)), closes [#503](https://github.com/gjsify/gjsify/issues/503)
* **e2e:** deracify the grandchild tree-kill test ([4dbb659](https://github.com/gjsify/gjsify/commit/4dbb6594646d9b8db9e358b81a1c3cd7a02a80e7))
* **e2e:** pin sdk-extension tsc check + wire ci ([5315d67](https://github.com/gjsify/gjsify/commit/5315d6757460269e4dfe29d240490ec982dc16f4))
* **e2e:** zombie-aware liveness check in tree-kill test ([e18f1cf](https://github.com/gjsify/gjsify/commit/e18f1cf156de4dc464cf90bff25b2a469db798d7))
* **rolldown-native:** gc-pressure regression guard ([0ba2fd8](https://github.com/gjsify/gjsify/commit/0ba2fd8e8545b75e338fb05da16098db4bc39f8d)), closes [#501](https://github.com/gjsify/gjsify/issues/501)

## [0.4.44](https://github.com/gjsify/gjsify/compare/v0.4.43...v0.4.44) (2026-06-08)

### Features

* **cli:** flatpak sources — offline dep vendoring ([0a9e83f](https://github.com/gjsify/gjsify/commit/0a9e83fcdbe523624d4c51bbb494366e7110bbb3))
* **cli:** flatpak sources reads all lockfiles ([8c1db14](https://github.com/gjsify/gjsify/commit/8c1db14ef1226d773eb8f2599697ca121eb2297e)), closes [#sha1](https://github.com/gjsify/gjsify/issues/sha1)

### Bug Fixes

* **cli:** ignore wins over global in affected classifier ([2cc89b4](https://github.com/gjsify/gjsify/commit/2cc89b43f9240d71e97c2a75f10fefa33cf98ead))
* enable Node-free self-build (2 bridge bugs) ([346d541](https://github.com/gjsify/gjsify/commit/346d541e8f48770b76a3a98b8ea45f972c2fd5bc))

### Documentation

* add and standardize package READMEs ([cde0613](https://github.com/gjsify/gjsify/commit/cde0613e9b055fcce4981496a7d9315e6f49904a))

### Continuous Integration

* exclude committed artifacts from build cache ([29db7fb](https://github.com/gjsify/gjsify/commit/29db7fb90dbe2a2caddd9014f5a03e81568984eb))

### Maintenance

* update native prebuilds [skip ci] ([67dc3f1](https://github.com/gjsify/gjsify/commit/67dc3f10ab047ee49e53a7f0b392fb3b7c442aff))

## [0.4.43](https://github.com/gjsify/gjsify/compare/v0.4.42...v0.4.43) (2026-06-07)

### Bug Fixes

* **cli:** native bundler writes nested chunk dirs ([6ed4220](https://github.com/gjsify/gjsify/commit/6ed4220dc7a6595f4ee08f060135963c922b862d))
* **cli:** self-update pulls runtime deps by default ([d159a1d](https://github.com/gjsify/gjsify/commit/d159a1d6224a8e0b51f99a67d094221cf77ab608))
* **npm-registry:** retry transient tarball 404s in gjsify install ([1ea7681](https://github.com/gjsify/gjsify/commit/1ea7681fe3a89abfc0cff2c0aff558cc84faf60b)), closes [#475](https://github.com/gjsify/gjsify/issues/475)
* **tsc:** keep committed libs on mismatched TS install ([a98edf9](https://github.com/gjsify/gjsify/commit/a98edf935ed6d54a97591e1efa544db2a57b7742))

### Tests

* **e2e:** retry npm install on transient registry errors ([f3dc9bd](https://github.com/gjsify/gjsify/commit/f3dc9bd87adcb5788a9f83c98810ef2832f78404))

## [Unreleased]

### Bug Fixes

* **cli:** `self-update` now pulls the on-disk runtime dependencies alongside the bundle by default (new `--skip-deps` restores the bundle-only fast path), so native bridges / `rolldown` / `lightningcss` / `@gjsify/tsc` no longer skew behind the updated `cli.gjs.mjs`.
* **npm-registry,install:** retry transient `404`s on tarball fetches (`fetchTarball` opts into `retryNotFound`), so a momentary registry/CDN hiccup on a `.tgz` under heavy parallel `@girs/*` load no longer aborts `gjsify install`. Packument 404s stay permanent (the package genuinely doesn't exist).

### Documentation

* **agents:** anchor the "Bundled-artifact dependency classification" rule in `AGENTS.md` — the bundled→devDep shortcut applies only to pure-bundle packages (`@gjsify/tsc`), never to dual-entry ones (`@gjsify/cli`, whose Node `bin` resolves its deps from `node_modules`).

### Tests

* **e2e:** retry the scaffolded `npm install` on transient registry errors (`npmInstallWithRetry` in `tests/e2e/helpers.mjs`, shared by `create-app` + `setupProject`) — absorbs the intermittent `@girs/*` tarball 404s that flaked the E2E job (one CI runner failing while another passed on the same commit). `npm run build` is deliberately not retried, so real regressions still fail deterministically.

## [0.4.42](https://github.com/gjsify/gjsify/compare/v0.4.41...v0.4.42) (2026-06-06)

### Build System

* self-host build:types on gjsify tsc ([#474](https://github.com/gjsify/gjsify/issues/474)) ([557d007](https://github.com/gjsify/gjsify/commit/557d0079579b51cb9c7e75d88bea83013ae83d42))
* self-host workspace check on gjsify tsc ([#472](https://github.com/gjsify/gjsify/issues/472)) ([f8c714e](https://github.com/gjsify/gjsify/commit/f8c714efc36b38251137176827862ff2b3c74df1))

## [0.4.41](https://github.com/gjsify/gjsify/compare/v0.4.40...v0.4.41) (2026-06-06)

### Bug Fixes

* **nativescript-vite:** drop vite-side ts-check ([6e85545](https://github.com/gjsify/gjsify/commit/6e8554527f82b31c9247d1bf89176e6d5a44aa69))

## [0.4.40](https://github.com/gjsify/gjsify/compare/v0.4.39...v0.4.40) (2026-06-05)

### Bug Fixes

* **cli:** expand globs in pack 'files' field ([2059689](https://github.com/gjsify/gjsify/commit/2059689d0c4e4f0ea4ce920cc55916e749519bbf)), closes [package.json#files](https://github.com/gjsify/package.json/issues/files)

## [0.4.39](https://github.com/gjsify/gjsify/compare/v0.4.38...v0.4.39) (2026-06-05)

### Bug Fixes

* **tsc:** commit lib*.d.ts (v0.4.38 shipped empty) ([bf74470](https://github.com/gjsify/gjsify/commit/bf74470eb952518964558ec0bdb388dd180d116b))

## [0.4.38](https://github.com/gjsify/gjsify/compare/v0.4.37...v0.4.38) (2026-06-05)

### Features

* **vite-plugin-gjsify:** register xmlns barrels for NS ([#466](https://github.com/gjsify/gjsify/issues/466)) ([6048c2a](https://github.com/gjsify/gjsify/commit/6048c2acc0523204b77e8b975acf31cf96a4510d))

### Bug Fixes

* **tsc:** bundle TS 6.0.3 + make it a real tsc drop-in ([#467](https://github.com/gjsify/gjsify/issues/467)) ([7088abd](https://github.com/gjsify/gjsify/commit/7088abdb5ad662965f297fb4706efeea73279efd)), closes [package.json#workspaces](https://github.com/gjsify/package.json/issues/workspaces) [package.json#files](https://github.com/gjsify/package.json/issues/files)

### Documentation

* **nativescript:** track upstream PRs [#11259](https://github.com/gjsify/gjsify/issues/11259) + [#6056](https://github.com/gjsify/gjsify/issues/6056) ([#465](https://github.com/gjsify/gjsify/issues/465)) ([615e25d](https://github.com/gjsify/gjsify/commit/615e25da3ee865617e5f9e7c3c0cb1d320e07a89))

### Tests

* move TS-5.x integration tests to TS 6 ([#468](https://github.com/gjsify/gjsify/issues/468)) ([24abd02](https://github.com/gjsify/gjsify/commit/24abd02334350a96dd22f4d8467011c08e197675)), closes [#467](https://github.com/gjsify/gjsify/issues/467) [package.json#workspaces](https://github.com/gjsify/package.json/issues/workspaces)

## [0.4.37](https://github.com/gjsify/gjsify/compare/v0.4.36...v0.4.37) (2026-06-04)

### Features

* **crypto:** implement browser ecdh via pure-bigint backend ([#434](https://github.com/gjsify/gjsify/issues/434)) ([14b722a](https://github.com/gjsify/gjsify/commit/14b722a7c9f9c77e551bde13091556ca00f65955))
* **fs:** add opfs persistence to browser polyfill ([#438](https://github.com/gjsify/gjsify/issues/438)) ([67125b0](https://github.com/gjsify/gjsify/commit/67125b07cfe4b61e63282da5b7b19ba5f399a299))
* gjsify login + logout (node-free npm auth) ([#462](https://github.com/gjsify/gjsify/issues/462)) ([6623644](https://github.com/gjsify/gjsify/commit/6623644a5151ce9765ddfdad87cb885925895197))
* **http:** complete fetch-backed browser client path ([#436](https://github.com/gjsify/gjsify/issues/436)) ([69985c9](https://github.com/gjsify/gjsify/commit/69985c9c0f147dfe47b9d1c3efbeffa0a940fe6d))
* nativescript platform file resolution + defines ([#451](https://github.com/gjsify/gjsify/issues/451)) ([a73a307](https://github.com/gjsify/gjsify/commit/a73a3078e463c59b087bb32439ab578a308f7ea5))
* **nativescript-vite:** vite 8 / rolldown compatibility composer ([#459](https://github.com/gjsify/gjsify/issues/459)) ([cafb31b](https://github.com/gjsify/gjsify/commit/cafb31b49db67f05049bb825991fc2056dfc1aa0))
* round out browser paths and declare nativescript slots ([#435](https://github.com/gjsify/gjsify/issues/435)) ([2d6a0e7](https://github.com/gjsify/gjsify/commit/2d6a0e7ad3bd0e8da5dafc347638a47f4615b0d7))
* round out zlib and https browser implementations ([#441](https://github.com/gjsify/gjsify/issues/441)) ([4031c16](https://github.com/gjsify/gjsify/commit/4031c16c2d1b6d0d3ae5fbc6448f557404b74fac))
* **runtimes:** declare nativescript native for web-api set ([#433](https://github.com/gjsify/gjsify/issues/433)) ([3fcdaa1](https://github.com/gjsify/gjsify/commit/3fcdaa124fafe0b5b134a07f373fd1fd68c2f850))
* **runtimes:** declare nativescript none for gjs-ui set ([#430](https://github.com/gjsify/gjsify/issues/430)) ([8bbc13b](https://github.com/gjsify/gjsify/commit/8bbc13bfb7e48b230fcd4b99c4965a5b6ce3b7e4))
* **runtimes:** declare nativescript none for node set ([#429](https://github.com/gjsify/gjsify/issues/429)) ([87a9faa](https://github.com/gjsify/gjsify/commit/87a9faa97cb958ac8c3cbc16e10d38e2354755fb))
* **runtimes:** declare nativescript none for web-gjs set ([#431](https://github.com/gjsify/gjsify/issues/431)) ([1e5a6fb](https://github.com/gjsify/gjsify/commit/1e5a6fb980ab2d326d4b5d24b47b65e489eb1216))
* **runtimes:** declare nativescript polyfill for portable node set ([#432](https://github.com/gjsify/gjsify/issues/432)) ([de9c03e](https://github.com/gjsify/gjsify/commit/de9c03e71036d72f09ff21fc7457647e9918ba95))
* standalone nativescript teapot showcase ([#461](https://github.com/gjsify/gjsify/issues/461)) ([e1343b3](https://github.com/gjsify/gjsify/commit/e1343b3a4920bfbf6d419228ba39fa29043b89fd))
* **worker_threads:** flesh out browser Worker path ([#437](https://github.com/gjsify/gjsify/issues/437)) ([535a467](https://github.com/gjsify/gjsify/commit/535a4674def5600c70dc93080a6453c89d5dd346))

### Bug Fixes

* **e2e:** hasCommand() walks PATH directly instead of which(1) ([6dfa37f](https://github.com/gjsify/gjsify/commit/6dfa37ff9cebba220fb44dc71a90dee2dd71ef3d))
* **node-polyfills,web-polyfills:** expose ./package.json in exports map ([d07246f](https://github.com/gjsify/gjsify/commit/d07246f617b3bcb7dfe384cc8e262df7cd54b31e))
* resolvable nativescript preset alias targets ([#457](https://github.com/gjsify/gjsify/issues/457)) ([f6058e1](https://github.com/gjsify/gjsify/commit/f6058e12af818913b342fbdc303c751a1267a267))
* **rolldown-plugin-pnp:** route node:* via this.resolve() under PnP ([3a5f361](https://github.com/gjsify/gjsify/commit/3a5f3616f3ff56eea2ee63b03e75900bbe695c53))
* **rolldown-plugin-pnp:** skip node:* specifiers in PnP resolver ([77b69cd](https://github.com/gjsify/gjsify/commit/77b69cd4ae09d8379fb3ddbe6201ed9ec05e2ac8)), closes [#425](https://github.com/gjsify/gjsify/issues/425)
* **showcase:** drop type:module from the nativescript teapot ([#464](https://github.com/gjsify/gjsify/issues/464)) ([f6ab375](https://github.com/gjsify/gjsify/commit/f6ab3754fd88d4f3f3611ec0c40915d9a75c001b))
* **webrtc:** throw operationerror on rtc-data-channel send over max-message-size ([#428](https://github.com/gjsify/gjsify/issues/428)) ([f5317a6](https://github.com/gjsify/gjsify/commit/f5317a6e49f248219e743472f27a310cf31bf0f3)), closes [#118](https://github.com/gjsify/gjsify/issues/118)

### Performance Improvements

* **install:** cache packuments with ETag revalidation ([#456](https://github.com/gjsify/gjsify/issues/456)) ([ded08f6](https://github.com/gjsify/gjsify/commit/ded08f6e07f00082398fe47a56548f99a4862215))
* **install:** gzip packuments, dedup cache fs ([#460](https://github.com/gjsify/gjsify/issues/460)) ([ee3adc8](https://github.com/gjsify/gjsify/commit/ee3adc8fbbae1036c60b864a20c1d825638e06ce)), closes [455/#456](https://github.com/455/gjsify/issues/456)
* **install:** lift Soup conn cap, reuse npm cache ([#452](https://github.com/gjsify/gjsify/issues/452)) ([8dfdf02](https://github.com/gjsify/gjsify/commit/8dfdf02f20609eea77b91d41a63d32d3516010b9))
* **install:** parallelize the resolve BFS ([#455](https://github.com/gjsify/gjsify/issues/455)) ([be37aec](https://github.com/gjsify/gjsify/commit/be37aecdb639703a2413f07104fce43a402cbfdb))

### Documentation

* **status:** record nativescript backfill and browser completion ([#447](https://github.com/gjsify/gjsify/issues/447)) ([90d5d97](https://github.com/gjsify/gjsify/commit/90d5d97e6b7924a43f5e0d8dcd1d640d305e7617))

### Continuous Integration

* enable strict runtime-audit gate with meta/asset carve-out ([#449](https://github.com/gjsify/gjsify/issues/449)) ([16de2cb](https://github.com/gjsify/gjsify/commit/16de2cbda8dfeaa441b1e17e35cc83dd8b2e1122))

### Maintenance

* **refs:** vendor nativescript-canvas submodule ([#450](https://github.com/gjsify/gjsify/issues/450)) ([59ed73d](https://github.com/gjsify/gjsify/commit/59ed73d6e3040a08ffd08b2ac68c822c857934f0))

### Tests

* add browser conformance entries for gamepad and xhr ([#444](https://github.com/gjsify/gjsify/issues/444)) ([1d59980](https://github.com/gjsify/gjsify/commit/1d59980518784c62ff5a2b8000c6a0ae1fcb95b5))
* add browser conformance tests for vm, zlib, https ([#446](https://github.com/gjsify/gjsify/issues/446)) ([46f7efc](https://github.com/gjsify/gjsify/commit/46f7efcebed7f883b6b97235fa1f32cb60992551))
* add browser specs for stream, domain, buffer ([#448](https://github.com/gjsify/gjsify/issues/448)) ([8d7e707](https://github.com/gjsify/gjsify/commit/8d7e707078865a53cc1d02f552d49a014000007f))
* add browser test entries for native re-export packages ([#443](https://github.com/gjsify/gjsify/issues/443)) ([2ed1cd4](https://github.com/gjsify/gjsify/commit/2ed1cd4a790bb531fccec9c57a770072b40cacc7))
* add browser-target specs for dns, sqlite, module ([#445](https://github.com/gjsify/gjsify/issues/445)) ([9120d01](https://github.com/gjsify/gjsify/commit/9120d01964cb977c8386fbcacff549f936cbdd44))
* add browser-target tests for process and os ([#440](https://github.com/gjsify/gjsify/issues/440)) ([1d49205](https://github.com/gjsify/gjsify/commit/1d492059f44d719718650ab797a194f0f4e1d0a2))
* **browser:** add browser test entries for core node packages ([#439](https://github.com/gjsify/gjsify/issues/439)) ([0c3c0bd](https://github.com/gjsify/gjsify/commit/0c3c0bd384e88fb8e3881091b753643a5c14f8e4))
* **e2e:** hard-require gjs/glib/msgfmt/yarn (drop silent skip-guards) ([d671d62](https://github.com/gjsify/gjsify/commit/d671d625daf55364531d99248b2772699133d83e))
* **nativescript:** on-device polyfill smoke suite ([#463](https://github.com/gjsify/gjsify/issues/463)) ([7183d6c](https://github.com/gjsify/gjsify/commit/7183d6cac70590347c7312b73a31ee0be786ebb2))
* **node:** add browser test entries for async_hooks/diagnostics_channel/sys ([#442](https://github.com/gjsify/gjsify/issues/442)) ([16dbaff](https://github.com/gjsify/gjsify/commit/16dbaff7eab9d14ef1f504892b73536fc39b73ea))

## [0.4.36](https://github.com/gjsify/gjsify/compare/v0.4.35...v0.4.36) (2026-05-31)

### Features

* **audit-runtimes:** introduce --quick opt-out alias (PR-B preparation) ([a215d19](https://github.com/gjsify/gjsify/commit/a215d1979ac1d85e209d2d636c001e399667cf80)), closes [#396](https://github.com/gjsify/gjsify/issues/396)
* **audit-runtimes:** opt-in --strict mode with functional probes ([6a21e72](https://github.com/gjsify/gjsify/commit/6a21e72a2f6a85020436e9a8c2d37dc165077e1d))
* **browser-node-polyfills:** umbrella meta-pkg for browser-side Node polyfills ([2291345](https://github.com/gjsify/gjsify/commit/2291345accd33b584c6729da408245c5ab572ebd)), closes [#392](https://github.com/gjsify/gjsify/issues/392) [#396](https://github.com/gjsify/gjsify/issues/396)
* **cli:** `gjsify affected` — workspaces touched by HEAD vs base ([2ff5729](https://github.com/gjsify/gjsify/commit/2ff572972877332bfcaadc0312c432d5b6a70f6f)), closes [#417](https://github.com/gjsify/gjsify/issues/417)
* **cli:** gjsify tsc subcommand — delegate to @gjsify/tsc bundle ([#389](https://github.com/gjsify/gjsify/issues/389)) ([9d7e462](https://github.com/gjsify/gjsify/commit/9d7e462253bad37d15e8f074985af513087937ea))
* **cli:** gjsify whoami subcommand ([#400](https://github.com/gjsify/gjsify/issues/400)) ([e2d67a6](https://github.com/gjsify/gjsify/commit/e2d67a64d1604b306dad4b2bcf73e91c27f7a23f))
* **cli:** tty-aware progress bar for gjsify install + dlx ([98b3e2b](https://github.com/gjsify/gjsify/commit/98b3e2b599056c82446be4cac20d27cc6acbee4f))
* **crypto:** browser polyfill via WebCrypto + crypto-browserify pattern (welle 3-C) ([28e7706](https://github.com/gjsify/gjsify/commit/28e77066e9df6fe0f6d6ef9e01d0b0b60a35c128))
* **fs:** in-memory browser polyfill (welle 3-D, memfs-inspired) ([382705a](https://github.com/gjsify/gjsify/commit/382705a67419f06e5ba3abf9f7fb011b84cbd385))
* **install:** content-addressable tarball cache ([4225994](https://github.com/gjsify/gjsify/commit/42259948a701740a4d407897ec00c74f57dbc4c7))
* **install:** workspace-scoped overrides ([8b99119](https://github.com/gjsify/gjsify/commit/8b9911920205f0eb5faab73753608d293970d7c7))
* **node:** browser polyfill entries for process/os/dns/ws/module (welle 3-A) ([862accc](https://github.com/gjsify/gjsify/commit/862accce4b6c922e8eb0b98490fd35db388b4dba)), closes [#386](https://github.com/gjsify/gjsify/issues/386) [#387](https://github.com/gjsify/gjsify/issues/387) [#388](https://github.com/gjsify/gjsify/issues/388) [#388](https://github.com/gjsify/gjsify/issues/388) [#386](https://github.com/gjsify/gjsify/issues/386) [#387](https://github.com/gjsify/gjsify/issues/387)
* **node:** browser polyfills for stream/http/https/zlib (welle 3-B) ([4ccabca](https://github.com/gjsify/gjsify/commit/4ccabca09502a97d007357954285a4ae6dd42335)), closes [#386](https://github.com/gjsify/gjsify/issues/386) [#387](https://github.com/gjsify/gjsify/issues/387) [#388](https://github.com/gjsify/gjsify/issues/388) [#392](https://github.com/gjsify/gjsify/issues/392) [#388](https://github.com/gjsify/gjsify/issues/388) [#386](https://github.com/gjsify/gjsify/issues/386) [#387](https://github.com/gjsify/gjsify/issues/387) [#388](https://github.com/gjsify/gjsify/issues/388)
* **node:** browser polyfills for worker_threads + vm + sqlite (welle 3-E) ([c0b7ee3](https://github.com/gjsify/gjsify/commit/c0b7ee370544ca2a283fbae63b4a30a3de93c83d))
* **resolve-npm:** add ALIASES_NODE_FOR_BROWSER export (unwired) ([08adc25](https://github.com/gjsify/gjsify/commit/08adc25a9fd97955c420782e4d04459cc8f1bffa))
* **resolve-npm:** browser globals-map (BROWSER_NATIVE_IDENTS + BROWSER_GLOBALS_MAP) ([bfd3132](https://github.com/gjsify/gjsify/commit/bfd3132e149e792754b38ad8c0a49fb53e3db2b5))
* **rolldown-plugin-gjsify:** browser target consumes ALIASES_NODE_FOR_BROWSER ([e3ed748](https://github.com/gjsify/gjsify/commit/e3ed748e63e587572bdc6a7c33fbc423306d3928)), closes [#388](https://github.com/gjsify/gjsify/issues/388)
* **runtimes:** nativescript as 4th runtime axis — foundation (welle 4-t) ([bdf0f71](https://github.com/gjsify/gjsify/commit/bdf0f710c06da8bd080a9ab5a764aa1ffb4ce894))
* **runtimes:** wave 2-W slot improvements for cross-runtime expansion ([56ce1ae](https://github.com/gjsify/gjsify/commit/56ce1aee72e0a54b86d9afa9fbd07b7565cb42d8))
* **tooling:** auto-rebuild CLI/tsc bundles via pre-commit hook ([d2ed4b2](https://github.com/gjsify/gjsify/commit/d2ed4b272572dde58f6fc4c32129f3f892dfe02e))
* **tsc:** smoke tests + CI bundle-staleness check ([#391](https://github.com/gjsify/gjsify/issues/391)) ([b9c5134](https://github.com/gjsify/gjsify/commit/b9c513469bd04dbedb5a2b14fc17b2acabbb0a2c)), closes [#385](https://github.com/gjsify/gjsify/issues/385)
* **workspace:** --with-dependencies flag for topological pre-build ([#398](https://github.com/gjsify/gjsify/issues/398)) ([21bf97a](https://github.com/gjsify/gjsify/commit/21bf97a2167a8d2face44fd1801fa0435a0a34d0))
* **workspace:** reverse-dep graph + affected-closure + file→ws mapping ([1576fcd](https://github.com/gjsify/gjsify/commit/1576fcd1214bc37131f8aea9b9d4245b0c2ef757))

### Bug Fixes

* **audit-runtimes:** close drift on cluster/inspector/readline + process ([4622626](https://github.com/gjsify/gjsify/commit/462262616a98dbb1e4f95c339377a21a8c4a1954))
* **child_process:** de-flake detached-spawn test (stdout race) ([c767d90](https://github.com/gjsify/gjsify/commit/c767d90b450d9cdf93cf387e15e97728c21ac3ab)), closes [#411](https://github.com/gjsify/gjsify/issues/411) [#413](https://github.com/gjsify/gjsify/issues/413) [#414](https://github.com/gjsify/gjsify/issues/414)
* **child_process:** de-flake detached-spawn test (stdout race) ([e256499](https://github.com/gjsify/gjsify/commit/e256499b2d02feaeb94896a9bbd3efec040148a7)), closes [#411](https://github.com/gjsify/gjsify/issues/411) [#413](https://github.com/gjsify/gjsify/issues/413) [#414](https://github.com/gjsify/gjsify/issues/414)
* **child_process:** de-flake detached-spawn test (stdout race) ([73a31b1](https://github.com/gjsify/gjsify/commit/73a31b10946596ecaf02bca30167f8ccd9bbd783)), closes [#411](https://github.com/gjsify/gjsify/issues/411) [#413](https://github.com/gjsify/gjsify/issues/413) [#414](https://github.com/gjsify/gjsify/issues/414)
* **child_process:** node-parity audit — 14 bugs, 86 new tests ([caa569a](https://github.com/gjsify/gjsify/commit/caa569a12ebed9fa498ec526e3005de29383a3a6)), closes [#407](https://github.com/gjsify/gjsify/issues/407)
* **child_process:** skip undefined env values + add deltachat integration ([ad39b4b](https://github.com/gjsify/gjsify/commit/ad39b4b97a0554d10737b40a55d9ef1c01698c6e))
* **ci:** revert main.yml switch + actions/checkout@v6 → v4 ([b5870a6](https://github.com/gjsify/gjsify/commit/b5870a64ef7fa12b5caecc6634a9d09909d7c59f))
* **ci:** script positional before option flags in foreach calls ([29c29bf](https://github.com/gjsify/gjsify/commit/29c29bfbf1ed122e1ceb46a455fa5297624c75d6))
* **cli,rolldown-plugin-gjsify:** cross-cwd rolldown resolve + inline register/* for --app gjs ([#399](https://github.com/gjsify/gjsify/issues/399)) ([adf66b9](https://github.com/gjsify/gjsify/commit/adf66b96de354f04476c8a6489f192e600e49c00)), closes [package.json#exports](https://github.com/gjsify/package.json/issues/exports)
* **cli:** resolve affected-classifier spec CLI entry from cwd ([b308ae9](https://github.com/gjsify/gjsify/commit/b308ae90fb7bb03c4b59136322679a12fba9354b))
* **cli:** use .ts extension for tarball-cache import ([0b3f835](https://github.com/gjsify/gjsify/commit/0b3f835ca24743837aa8e6e7d39fb996e24bf996))
* **cli:** use .ts extension for tarball-cache import ([3929547](https://github.com/gjsify/gjsify/commit/39295477e26df7a9d1406eb7eb270be49cda7ad5))
* **deps:** align @girs/* across integration tests + framework bridges ([699a9cc](https://github.com/gjsify/gjsify/commit/699a9cca58052bd0533ef76674fb5eceb8064256))
* **dom-events:** report listener exceptions via reportError + safe console fallback ([#426](https://github.com/gjsify/gjsify/issues/426)) ([2c78fc9](https://github.com/gjsify/gjsify/commit/2c78fc9ecfb06669991d8c5fab82c3a4ede6c982))
* **e2e:** drive native-install harness against compiled lib/ output ([bd7eb7f](https://github.com/gjsify/gjsify/commit/bd7eb7fcc0f7106f13cd730c510295bd1a72d46e))
* **e2e:** drive native-install harness against compiled lib/ output ([e90a9a1](https://github.com/gjsify/gjsify/commit/e90a9a1354a2066e992b9bb4f2ce8d435be9f3ee))
* **fs:** drop browser condition from ./promises export ([5af2113](https://github.com/gjsify/gjsify/commit/5af21137f1531118458b8c06dfdd2d1ee14263ec))
* **node:** drop top-level browser field — causes node:* leak on --app gjs ([839d06c](https://github.com/gjsify/gjsify/commit/839d06c1c710a05152efa843f386c31118ac3def)), closes [#393](https://github.com/gjsify/gjsify/issues/393)
* **node:** drop top-level browser field — causes node:* leak on --app gjs ([b273e66](https://github.com/gjsify/gjsify/commit/b273e664c148de1abbb1dfb745e5de9f02ffa523)), closes [#393](https://github.com/gjsify/gjsify/issues/393)
* **node:** drop top-level browser field — causes node:* leak on --app gjs ([4f98da2](https://github.com/gjsify/gjsify/commit/4f98da2310f9174559057cc4b37e1e073db7e0b1)), closes [#393](https://github.com/gjsify/gjsify/issues/393)
* **node:** drop top-level browser field — causes node:* leak on --app gjs ([45cc791](https://github.com/gjsify/gjsify/commit/45cc791b9a2acd123111f78719231c3c484fa4ef)), closes [#393](https://github.com/gjsify/gjsify/issues/393)
* **node:** drop top-level browser field — causes node:* leak on --app gjs ([4fc4a4c](https://github.com/gjsify/gjsify/commit/4fc4a4cf4dc436f17d99a4ab601f6c715aa3cdfc)), closes [#397](https://github.com/gjsify/gjsify/issues/397)
* **npm-registry,install:** per-fetch timeout + clear timeout error ([#402](https://github.com/gjsify/gjsify/issues/402)) ([41a6059](https://github.com/gjsify/gjsify/commit/41a6059eae8fa732379a441ccb2a2118bec630b5))
* **publish:** diagnose dead-token 404 via /-/whoami probe ([#390](https://github.com/gjsify/gjsify/issues/390)) ([c645742](https://github.com/gjsify/gjsify/commit/c64574292b1bd48b1f927564052a74c09b56840f))
* **ws:** disable server-side permessage-deflate to unblock loopback message flow ([#427](https://github.com/gjsify/gjsify/issues/427)) ([1f284c0](https://github.com/gjsify/gjsify/commit/1f284c0efc6e4a937f7b2c580d91f0f80b71f8ac)), closes [#115](https://github.com/gjsify/gjsify/issues/115)
* **zlib:** zstd stubs for undici v7 compat ([#404](https://github.com/gjsify/gjsify/issues/404)) ([b7a45e4](https://github.com/gjsify/gjsify/commit/b7a45e4c3382db2947a7396d456a9f27aff5b172)), closes [nodejs/node#56777](https://github.com/nodejs/node/issues/56777)

### Performance Improvements

* **install:** parallelize workspace-symlink wiring ([792d522](https://github.com/gjsify/gjsify/commit/792d522edd6db76df00d36e2e00864ba6bbba934)), closes [#414](https://github.com/gjsify/gjsify/issues/414)

### Documentation

* **agents:** fix nonsense v0.4.35 → v0.4.20 in first-publish incident note ([86ca8b3](https://github.com/gjsify/gjsify/commit/86ca8b39211d57667e97ae8097d6e20e29c6943c))
* **agents:** selective-CI section under Testing ([4d452c3](https://github.com/gjsify/gjsify/commit/4d452c3de13ba15ffd232aa1d1f37ee152faa9b1)), closes [#421](https://github.com/gjsify/gjsify/issues/421) [#421](https://github.com/gjsify/gjsify/issues/421) [#420](https://github.com/gjsify/gjsify/issues/420) [#410](https://github.com/gjsify/gjsify/issues/410) [#408](https://github.com/gjsify/gjsify/issues/408) [#406](https://github.com/gjsify/gjsify/issues/406)
* **status:** summarize welle 3-F browser-polyfill wiring ([e06f506](https://github.com/gjsify/gjsify/commit/e06f506d452445d2bc60b6807d4804cce9162717))

### Continuous Integration

* cache lib/ + tsbuildinfo between runs ([#423](https://github.com/gjsify/gjsify/issues/423)) ([747808f](https://github.com/gjsify/gjsify/commit/747808f5ea7c3d32930bc4f8bd1ce6a5c006cd98))
* don't run integration tests on PRs (align with AGENTS.md) ([63b2bdf](https://github.com/gjsify/gjsify/commit/63b2bdfdd9b443c151e096320838f208b3a25715))
* exclude integration-autobahn from CI sweep (needs Podman) ([7cefe43](https://github.com/gjsify/gjsify/commit/7cefe4372c8d1715cd19efafe806c60295139adf))
* force re-trigger workflow run ([a1620ad](https://github.com/gjsify/gjsify/commit/a1620ad2a07480da1e194c859f94f9e2624038da))
* **main:** selective tests via `gjsify affected` gates ([70ffa7d](https://github.com/gjsify/gjsify/commit/70ffa7d9bca0dcffd8d200655aebff7fe535393e)), closes [#418](https://github.com/gjsify/gjsify/issues/418) [#417](https://github.com/gjsify/gjsify/issues/417) [#418](https://github.com/gjsify/gjsify/issues/418)
* pre-baked Fedora image — skip dnf install on every job ([b2cb5b0](https://github.com/gjsify/gjsify/commit/b2cb5b0bc597374eaa83b9d6a3d04e5188276889))

### Maintenance

* **deps:** align typescript range to ^5.9.3 workspace-wide (declaration vs lockfile cleanup) ([290c7b6](https://github.com/gjsify/gjsify/commit/290c7b6b79b432982d7b06b9c1173150d76e76c7)), closes [#385](https://github.com/gjsify/gjsify/issues/385)
* **deps:** bulk minor + patch bumps via gjsify upgrade --minor ([8111d18](https://github.com/gjsify/gjsify/commit/8111d183fec9a5fa924cf6304370a7055d2e5a7f))
* drop accidentally-staged .claude/ worktree dir ([a3294a9](https://github.com/gjsify/gjsify/commit/a3294a94c72d8397de7de46745e4fb4c3d28319d))
* **gitignore:** exclude .claude/ (claude code agent worktrees) ([dbd8ebb](https://github.com/gjsify/gjsify/commit/dbd8ebb753ead7f90cf709f754bab34291332a45))
* **lock:** refresh gjsify-lock.json for deltachat devdeps ([29b015e](https://github.com/gjsify/gjsify/commit/29b015e2688772a6a9a86a631ea4bcccaf6dd1cc))
* **lock:** refresh gjsify-lock.json for yjs + y-protocols devdeps ([523c9b6](https://github.com/gjsify/gjsify/commit/523c9b67a724c7c369101abbdd861a07fd758267))
* **packages:** add license + repository + bugs + homepage to all published packages ([88e50aa](https://github.com/gjsify/gjsify/commit/88e50aa345e732851e09cf3969b938950222a368))
* **refs:** vendor 5 nativescript submodules (welle 4-s) ([6cb1330](https://github.com/gjsify/gjsify/commit/6cb1330a905b8816825d5a999d64e3b03292f594))
* **refs:** vendor 9 browser-polyfill submodules for cross-runtime wave ([6308873](https://github.com/gjsify/gjsify/commit/6308873382f80dc934e2e46ced846eb4a2406183))
* **status:** remove stale BLOCKER entry for @gjsify/vite-plugin-gjsify ([465f1f1](https://github.com/gjsify/gjsify/commit/465f1f113bfbb25d279bf914224b34afb095c6ca))

### Tests

* **browser:** include packages/node in discover-bundles ([50061e4](https://github.com/gjsify/gjsify/commit/50061e4ee592bb105c813880f5e49a7640bbd4a2))
* **integration/deltachat:** port chatmail/core upstream basic.ts tests ([0f4bd53](https://github.com/gjsify/gjsify/commit/0f4bd53189f8d41a30679ef726f81ac48cdbc437))
* **integration/loro-crdt:** expand from 57 to 166 tests on Node + GJS ([d22c61d](https://github.com/gjsify/gjsify/commit/d22c61d4c687a297dea27c5e1d9f038000960a1e))
* **integration/mcp:** port stdio / in-memory / uri-template tests from upstream sdk ([7410ffb](https://github.com/gjsify/gjsify/commit/7410ffbc82261f576430f67888464152585eead4))
* **integration/yjs:** new suite — 147 assertions / 54 cases on node + gjs ([c9d9ec5](https://github.com/gjsify/gjsify/commit/c9d9ec59c65401f1a45df18c7411e6c7792f3126))

## [0.4.35](https://github.com/gjsify/gjsify/compare/v0.4.34...v0.4.35) (2026-05-29)

### Features

* **cli:** flatpak — `.desktop` MimeType= from `provides.mimetypes` ([2931c74](https://github.com/gjsify/gjsify/commit/2931c746ad27fc4d2679c82e4ea95b823b34939f))
* **tsc:** @gjsify/tsc — Node-free TypeScript compiler under GJS ([#385](https://github.com/gjsify/gjsify/issues/385)) ([d6f3225](https://github.com/gjsify/gjsify/commit/d6f32256bb769b36a7c73c657be4f91e291001d8))

### Bug Fixes

* **tls-session:** close missing braces in session-resumption.spec.ts ([1c462d1](https://github.com/gjsify/gjsify/commit/1c462d121dee7a3a73bd13791cf6e859e4f29a05))
* **tls-session:** use ConnectionOptions type for tls.connect — drop bogus Parameters cast ([8c831a7](https://github.com/gjsify/gjsify/commit/8c831a79ec03e045cca765e7e469e3c875a88b2c))
* **tls-session:** use satisfies ConnectionOptions to disambiguate tls.connect overload ([5465663](https://github.com/gjsify/gjsify/commit/54656638a1d7ccb297c29b0714eeb8c3787f7ddc))

### Documentation

* **e2e:** expand undici suite STATUS + README coverage row ([99a89a2](https://github.com/gjsify/gjsify/commit/99a89a28f88b41b48d7719fe8370a0645d9cbaf1))
* **e2e:** undici GJS hits @gjsify/zlib Zstd impl gap, document follow-up ([b59fa37](https://github.com/gjsify/gjsify/commit/b59fa37ab1c7d1df14f693113adf6da3a57cb966))

### Code Refactoring

* **http2:** per-concern split of server/response.ts ([83e0b68](https://github.com/gjsify/gjsify/commit/83e0b685d1aa94a571a6e954d74334c12f578f49)), closes [#261](https://github.com/gjsify/gjsify/issues/261) [#273](https://github.com/gjsify/gjsify/issues/273) [#309](https://github.com/gjsify/gjsify/issues/309)
* **querystring:** per-concern split of index.ts ([b391ed7](https://github.com/gjsify/gjsify/commit/b391ed7152f4d0141a00e9b7b3cfa1bc4c8c6b6c)), closes [package.json#exports](https://github.com/gjsify/package.json/issues/exports) [#309](https://github.com/gjsify/gjsify/issues/309)
* **webgl:** per-concern split of shader-program.ts ([6f88c0f](https://github.com/gjsify/gjsify/commit/6f88c0f9335a6a4bf238c4bb82531456d65d4f47)), closes [273/#309](https://github.com/273/gjsify/issues/309)
* **webgl:** per-concern split of texture-management.ts ([b833efa](https://github.com/gjsify/gjsify/commit/b833efa0318c91929f64de89546ff04309162b31)), closes [#309](https://github.com/gjsify/gjsify/issues/309) [#273](https://github.com/gjsify/gjsify/issues/273) [#309](https://github.com/gjsify/gjsify/issues/309) [#273](https://github.com/gjsify/gjsify/issues/273) [#262](https://github.com/gjsify/gjsify/issues/262)

### Continuous Integration

* retrigger ([19b2f2f](https://github.com/gjsify/gjsify/commit/19b2f2faf47606978b4ee2ded90ef103ac659229))

### Maintenance

* **debug:** refresh gjsify-lock.json for debug devDep ([99b9c46](https://github.com/gjsify/gjsify/commit/99b9c4633ad319541873db50b5877a74a327ef91))
* **undici:** refresh gjsify-lock.json for undici devDep ([14166f1](https://github.com/gjsify/gjsify/commit/14166f1554cbeec7af0bfce5be00f552c1248b47))

### Tests

* **e2e:** chalk integration suite — color codes + level gating + truecolor ([0611582](https://github.com/gjsify/gjsify/commit/0611582b9e057a0f8800173a4ccaab88d40c2c33))
* **e2e:** debug integration suite — namespace matching + format specifiers + tty output ([787418d](https://github.com/gjsify/gjsify/commit/787418d93acacb11797b49a0cb2572f0597cfe18))
* **e2e:** drop strict protocol assertion on GJS channel-binding spec ([2d84dc0](https://github.com/gjsify/gjsify/commit/2d84dc01e04607aa657980b5576e376f319a2037))
* **e2e:** tls-session integration suite — phase 2 round-trip + channel binding ([23843e1](https://github.com/gjsify/gjsify/commit/23843e10286fc6417a23cbf645863f56a6d6fabc)), closes [#360](https://github.com/gjsify/gjsify/issues/360)
* **e2e:** undici integration suite — fetch + request + websocket ([7eb2dc5](https://github.com/gjsify/gjsify/commit/7eb2dc50a419062362f4e73f6d9024d2401f61c6))

## [0.4.34](https://github.com/gjsify/gjsify/compare/v0.4.33...v0.4.34) (2026-05-29)

### Features

* **upgrade:** --exclude-workspace flag + CI dep-consistency gate ([0d2a2c3](https://github.com/gjsify/gjsify/commit/0d2a2c3cdcebfd455ec6a4ff0a54ea9ad39e34a0))
* **upgrade:** workspace-aware aggregation + --align + --check ([a0fda21](https://github.com/gjsify/gjsify/commit/a0fda2159bb61980f443ba1687d4bd41ca0b7b75))

### Maintenance

* **deps:** align rolldown + vite ranges across workspace ([5b6ea38](https://github.com/gjsify/gjsify/commit/5b6ea38d343b05f6706f7a3ba3249297c0f2a2c1)), closes [#371](https://github.com/gjsify/gjsify/issues/371)
* **refs:** add glib-networking submodule (TLS Phase 2 vendored struct layout source) ([541c20c](https://github.com/gjsify/gjsify/commit/541c20c860181118a7b94fe5f473d846a93360b3))

## [0.4.33](https://github.com/gjsify/gjsify/compare/v0.4.32...v0.4.33) (2026-05-28)

### Features

* **fetch:** ship globals.mjs + native routing on Node and browser ([41693ac](https://github.com/gjsify/gjsify/commit/41693ac9978c48baaa07fd76cea953ebdb61ef7f)), closes [#362](https://github.com/gjsify/gjsify/issues/362) [#368](https://github.com/gjsify/gjsify/issues/368)
* **web:** wire cross-runtime tests + correct websocket native triplet ([acac9ce](https://github.com/gjsify/gjsify/commit/acac9ce59fbd6f82f871db0e08e0afaa7b03dac8)), closes [#362](https://github.com/gjsify/gjsify/issues/362)

### Bug Fixes

* **resolve-npm:** route bare 'dom-events' to polyfill on Node ([7e0640f](https://github.com/gjsify/gjsify/commit/7e0640f1877fdacc736d029698b90a7f897b810b))

### Documentation

* **strategy:** graduate cross-runtime portability out of experimental ([e3843b8](https://github.com/gjsify/gjsify/commit/e3843b89922de52086b47dabe3f7559dbe0ee06c))

## [0.4.32](https://github.com/gjsify/gjsify/compare/v0.4.31...v0.4.32) (2026-05-28)

### Features

* **resolve-npm:** route @gjsify/* aliases via runtimes triplet ([6482e5e](https://github.com/gjsify/gjsify/commit/6482e5e7e84654a3c9873b2ba24d4292ca7514af))
* **scripts:** audit-runtimes --check for CI drift ([fb2c9d2](https://github.com/gjsify/gjsify/commit/fb2c9d29a45e837156984e52058646d74be35a85))
* **tls-native:** phase 2 path-A — flip session-access to functional ([7605347](https://github.com/gjsify/gjsify/commit/76053472f0f245a8b950ea04eaf65955cd758f36)), closes [#342](https://github.com/gjsify/gjsify/issues/342) [#342](https://github.com/gjsify/gjsify/issues/342)

### Bug Fixes

* **fs:** rmSync must not walk into target of a top-level symlink ([#366](https://github.com/gjsify/gjsify/issues/366)) ([80e5e67](https://github.com/gjsify/gjsify/commit/80e5e67cd562d2ed4b99d8ed01a7badddad6cfb8))
* **rolldown-plugin-gjsify,utils,os:** make --app node bundles loadable on Node ([e157645](https://github.com/gjsify/gjsify/commit/e157645e22f8be076157007f07647c776f5d31bb)), closes [Pre-#342](https://github.com/gjsify/Pre-/issues/342)

### Documentation

* **strategy:** declare cross-runtime portability direction + audit foundation ([6d1d0ff](https://github.com/gjsify/gjsify/commit/6d1d0ff355177e912a378d5baa5fdc135438cd74))

### Maintenance

* **lint:** clear remaining consistent-type-imports warnings ([307482c](https://github.com/gjsify/gjsify/commit/307482cf10a997ad94f6298ce77034716624b036)), closes [#358](https://github.com/gjsify/gjsify/issues/358)
* update native prebuilds [skip ci] ([4342bab](https://github.com/gjsify/gjsify/commit/4342bab41e1de19bb21192dd83b67b323d1b7db6))

### Tests

* **web:** validate cross-runtime exemplars on gjs+node+browser ([845e9b1](https://github.com/gjsify/gjsify/commit/845e9b1580a66e9101c7bda4643a6b3f03de2a07))

## [0.4.31](https://github.com/gjsify/gjsify/compare/v0.4.30...v0.4.31) (2026-05-28)

### Features

* **tls-native:** SessionAccess scaffold for session resumption + channel binding (Phase 2 native bits) ([0c521ed](https://github.com/gjsify/gjsify/commit/0c521ed2220b9dac4ebd9ecefefb8ad6dac5c75f))

### Documentation

* **status:** v0.4.31 consolidation entry (no-any sweep + chokidar/dotenv/TLS Phase 2) ([0e09e7a](https://github.com/gjsify/gjsify/commit/0e09e7a5aea21d567affdab276b60eb03ca80619))

### Continuous Integration

* retrigger ([a427a48](https://github.com/gjsify/gjsify/commit/a427a486ff99326c5d8a4711fe790a872c00b260))
* retrigger ([dfd4240](https://github.com/gjsify/gjsify/commit/dfd42407cd1c909a5db2fb06123b170952526ac2))
* retrigger ([88cff63](https://github.com/gjsify/gjsify/commit/88cff63475b02993a9a46fcee71c48366421ce6d))

### Maintenance

* **crypto:** type the any-typed @gjsify/crypto (no-explicit-any → 0) ([#350](https://github.com/gjsify/gjsify/issues/350)) ([1f730f1](https://github.com/gjsify/gjsify/commit/1f730f1d8e3c23cab39ac9e07878dffaafb0428d))
* eliminate remaining no-explicit-any warnings (long tail) ([341d3ad](https://github.com/gjsify/gjsify/commit/341d3ad83f94ca9fb1c203771d4bb9f34ed0c6aa))
* **fs:** type the any-typed @gjsify/fs (no-explicit-any → 0) ([#347](https://github.com/gjsify/gjsify/issues/347)) ([ff8b995](https://github.com/gjsify/gjsify/commit/ff8b995e975187262a7cd5c486ae30ba4e811d02))
* **http2:** type the any-typed @gjsify/http2 (no-explicit-any → 0) ([#353](https://github.com/gjsify/gjsify/issues/353)) ([4e42de8](https://github.com/gjsify/gjsify/commit/4e42de8d08d82eb248d870cd908a164898a21999)), closes [334/#336](https://github.com/334/gjsify/issues/336) [#348](https://github.com/gjsify/gjsify/issues/348) [#351](https://github.com/gjsify/gjsify/issues/351)
* **node,framework:** type the any-typed node-networking + framework packages (no-explicit-any → 0) ([#356](https://github.com/gjsify/gjsify/issues/356)) ([3143f5f](https://github.com/gjsify/gjsify/commit/3143f5f325ebbb59a2b44cc329166f187e000b8b)), closes [334/#336](https://github.com/334/gjsify/issues/336)
* **node:** type the any-typed node-utility packages (no-explicit-any → 0) ([#346](https://github.com/gjsify/gjsify/issues/346)) ([580274d](https://github.com/gjsify/gjsify/commit/580274df1ac9218cbf27d8e53d06375e9479d69b)), closes [335/#337](https://github.com/335/gjsify/issues/337)
* **node:** type the any-typed small node packages (no-explicit-any → 0) ([#348](https://github.com/gjsify/gjsify/issues/348)) ([2da2d4c](https://github.com/gjsify/gjsify/commit/2da2d4c016bc617e95291c4554b46b5dba033263))
* **sqlite:** type the any-typed @gjsify/sqlite (no-explicit-any → 0) ([#349](https://github.com/gjsify/gjsify/issues/349)) ([6244d2e](https://github.com/gjsify/gjsify/commit/6244d2ece18f670785dcb897d076cb79732c9510))
* update native prebuilds [skip ci] ([f82107f](https://github.com/gjsify/gjsify/commit/f82107fdf1067bc026d40d12826513254d781da4))
* **vala-bridges:** disable no-any in generated ts-for-gir .d.ts files ([#351](https://github.com/gjsify/gjsify/issues/351)) ([bd2cfde](https://github.com/gjsify/gjsify/commit/bd2cfde3bdd2fbb100f18240b642f2069d408006))
* **web:** eliminate no-explicit-any warnings in small web packages ([ee2adf8](https://github.com/gjsify/gjsify/commit/ee2adf8ca23f4f22d77670eb7764d2dc9d80877d))
* **webgl:** type the any-typed @gjsify/webgl (no-explicit-any → 0) ([#355](https://github.com/gjsify/gjsify/issues/355)) ([f2f1f1d](https://github.com/gjsify/gjsify/commit/f2f1f1dfa41afc8bbb82f5e56733e63fca90c5e4))
* **webrtc:** type the any-typed @gjsify/webrtc (no-explicit-any → 0) ([#354](https://github.com/gjsify/gjsify/issues/354)) ([66e5730](https://github.com/gjsify/gjsify/commit/66e573007cb1ae28b3c6f74bcaf7a540f071de3b)), closes [334/#336](https://github.com/334/gjsify/issues/336)
* **ws:** type the any-typed @gjsify/ws (no-explicit-any → 0) ([e1df450](https://github.com/gjsify/gjsify/commit/e1df450d1f9772f2df10afbfad39272a38beb3a0)), closes [334/#336](https://github.com/334/gjsify/issues/336)

### Tests

* **e2e:** chokidar integration suite + fs.watch root-cause fix ([7d1062c](https://github.com/gjsify/gjsify/commit/7d1062cac014ba139497f2ad3ae2f8f7a00d1f2c))
* **e2e:** dotenv integration suite — process.env + fs path coverage ([bbf2f2e](https://github.com/gjsify/gjsify/commit/bbf2f2e4f9a95b6be822e4d25eaab1079ce8eb82))

## [0.4.30](https://github.com/gjsify/gjsify/compare/v0.4.29...v0.4.30) (2026-05-28)

### Bug Fixes

* **fetch:** hold Soup.Session against GC to stop host->conns race ([#339](https://github.com/gjsify/gjsify/issues/339)) ([db79767](https://github.com/gjsify/gjsify/commit/db79767f161ee10e3f06b0f0b5bb3a74df9be498))
* **install:** never fetch/extract over workspace sources (data-loss bug) ([#338](https://github.com/gjsify/gjsify/issues/338)) ([320bfd1](https://github.com/gjsify/gjsify/commit/320bfd1055f7bb57ea158934b78b5707b7ea5e97))
* repair [#334](https://github.com/gjsify/gjsify/issues/334) no-explicit-any over-narrowing regressions ([#340](https://github.com/gjsify/gjsify/issues/340)) ([6723129](https://github.com/gjsify/gjsify/commit/6723129d2ad50b7cd3e65afcd76f53fec15eba74)), closes [#336](https://github.com/gjsify/gjsify/issues/336)
* repair remaining [#336](https://github.com/gjsify/gjsify/issues/336) over-narrowing (examples/showcases) + refresh CLI bundle ([#341](https://github.com/gjsify/gjsify/issues/341)) ([ba074de](https://github.com/gjsify/gjsify/commit/ba074deac1fee0460d7d45b9de7d1afdc506e697))
* **website:** reset Starlight content margins leaking into live-demo embeds ([#333](https://github.com/gjsify/gjsify/issues/333)) ([94a7334](https://github.com/gjsify/gjsify/commit/94a733451e0b260f1e1ee83a3267fddd238e731a))

### Maintenance

* type the any-typed gjs/infra/dom code (no-explicit-any → 0) ([#334](https://github.com/gjsify/gjsify/issues/334)) ([1746e2a](https://github.com/gjsify/gjsify/commit/1746e2a70a3332f3fd7a32dce07568cbe6d9b019))
* type the any-typed node stream/events/buffer (no-explicit-any → 0) ([#335](https://github.com/gjsify/gjsify/issues/335)) ([231b438](https://github.com/gjsify/gjsify/commit/231b438d1e0ec9a3decf4c52ce1e28dfc407f18c))
* type the any-typed test/example/showcase code (no-explicit-any → 0) ([#336](https://github.com/gjsify/gjsify/issues/336)) ([7971335](https://github.com/gjsify/gjsify/commit/79713350e671187607c953fd6d5d20c0eb8ab351))
* type the any-typed web/streams generics (no-explicit-any → 0) ([#337](https://github.com/gjsify/gjsify/issues/337)) ([e2afb08](https://github.com/gjsify/gjsify/commit/e2afb085c54d9a72934f7b7219a50664af600635))

## [0.4.29](https://github.com/gjsify/gjsify/compare/v0.4.28...v0.4.29) (2026-05-27)

### Features

* **bundler:** top-level define alias+warning + dataurl/text loaders ([#322](https://github.com/gjsify/gjsify/issues/322)) ([213ab57](https://github.com/gjsify/gjsify/commit/213ab57f033f2ebc150ed1e364d7f0e04dce8fcc)), closes [#58](https://github.com/gjsify/gjsify/issues/58)
* **tooling:** migrate Biome → oxc (oxlint + oxfmt) + GObject.registerClass rule ([#328](https://github.com/gjsify/gjsify/issues/328)) ([331e26c](https://github.com/gjsify/gjsify/commit/331e26c617852cf88682c069155c65ec18fbbad4)), closes [GNOME/gjs#704](https://github.com/GNOME/gjs/issues/704)

### Bug Fixes

* **dom-elements:** wire clientWidth/clientHeight to GTK allocation ([#327](https://github.com/gjsify/gjsify/issues/327)) ([fbc90aa](https://github.com/gjsify/gjsify/commit/fbc90aa86bad65a7ada0ce4f5facb69b9d754d5d))
* **dom-elements:** wire offsetWidth/Height + scrollWidth/Height too ([#329](https://github.com/gjsify/gjsify/issues/329)) ([b1abe38](https://github.com/gjsify/gjsify/commit/b1abe38d0e67d5f3e0e2ec2f9da2668f82e7f926))
* **webgl:** per-ID matching for cancelAnimationFrame on WebGLBridge ([#330](https://github.com/gjsify/gjsify/issues/330)) ([2f4f9e0](https://github.com/gjsify/gjsify/commit/2f4f9e06a3ccf277e0671649b1c5a460c598ae99))

### Maintenance

* drop stale [Unreleased] changelog section ([995e3d5](https://github.com/gjsify/gjsify/commit/995e3d53a64b5a861767c2e71c1d812026994ebd))
* **lint:** the last 6 no-unused-vars warnings ([c20c166](https://github.com/gjsify/gjsify/commit/c20c16658c6a5d11ad58b65c6801f79f6069a9ec)), closes [#331](https://github.com/gjsify/gjsify/issues/331) [#331](https://github.com/gjsify/gjsify/issues/331) [#331](https://github.com/gjsify/gjsify/issues/331)
* **oxlint:** ignore build artifacts + standard `_`-prefix unused-vars ([#332](https://github.com/gjsify/gjsify/issues/332)) ([d7f3f0d](https://github.com/gjsify/gjsify/commit/d7f3f0d11608d7e824010ee14a829e2cf70945b1))
* triage oxlint warnings (clean unused-vars/type-imports; trim easy any) ([#331](https://github.com/gjsify/gjsify/issues/331)) ([18c676a](https://github.com/gjsify/gjsify/commit/18c676afc7d801503d840a8825c1f61328a57bf9))

## [0.4.28](https://github.com/gjsify/gjsify/compare/v0.4.27...v0.4.28) (2026-05-27)

### Features

* @gjsify/vite-plugin-gjsify (Vite-dev parity with --app browser) ([#319](https://github.com/gjsify/gjsify/issues/319)) ([5e3a6d6](https://github.com/gjsify/gjsify/commit/5e3a6d6e26f34c5517111519135e82f109c696c9))
* **cli:** --help shows the active runtime (GJS/Node + version) ([#321](https://github.com/gjsify/gjsify/issues/321)) ([45d6bbc](https://github.com/gjsify/gjsify/commit/45d6bbc7d651fb63a59d2a9bd0922f3202751cd6))
* **cli:** gjsify publish --otp (npm 2FA) for Node-free manual publishes ([#324](https://github.com/gjsify/gjsify/issues/324)) ([4a10e1e](https://github.com/gjsify/gjsify/commit/4a10e1e3a752bd3a28c7c746ccb3cce3afefaa91))

### Bug Fixes

* **cli:** self-update — drop stray packument fetch + make idempotent ([#326](https://github.com/gjsify/gjsify/issues/326)) ([7c6e83c](https://github.com/gjsify/gjsify/commit/7c6e83c3df4e514cd54b6f624cfa6b01624a82e1))
* **website:** nicer showcase names, single chevron, coverage on subpages, live-demo chrome ([#320](https://github.com/gjsify/gjsify/issues/320)) ([ec9b462](https://github.com/gjsify/gjsify/commit/ec9b4625fb0236595fc12dc6d14792fb2a236dcc))

### Maintenance

* complete changelogs (all commit types) + commitlint ([#325](https://github.com/gjsify/gjsify/issues/325)) ([34abb13](https://github.com/gjsify/gjsify/commit/34abb13ea9c948d42107f6e0f1940d43c58dd30c))

### Tests

* **e2e:** add 4 CLI-coverage suites (app-browser, gresource, publish, self-update) ([#323](https://github.com/gjsify/gjsify/issues/323)) ([406f742](https://github.com/gjsify/gjsify/commit/406f74213fca00b7687f03ebfb37d9fec172c9ad)), closes [#315](https://github.com/gjsify/gjsify/issues/315) [#316](https://github.com/gjsify/gjsify/issues/316) [#317](https://github.com/gjsify/gjsify/issues/317) [#318](https://github.com/gjsify/gjsify/issues/318)

## [0.4.27](https://github.com/gjsify/gjsify/compare/v0.4.26...v0.4.27) (2026-05-26)

### Features

* **cli:** --shebang emits node hashbang for --app node ([#314](https://github.com/gjsify/gjsify/issues/314)) ([d95b4ff](https://github.com/gjsify/gjsify/commit/d95b4ff1f497777ab9cde4738628eacf1caf3425))

## [0.4.26](https://github.com/gjsify/gjsify/compare/v0.4.25...v0.4.26) (2026-05-26)

### Bug Fixes

* **compression-streams:** await lazy zlib load in transform, not at construction ([#312](https://github.com/gjsify/gjsify/issues/312)) ([6b38d73](https://github.com/gjsify/gjsify/commit/6b38d73a305f80fe60863c43d5df1b1180e91515))
* **rolldown-plugin-gjsify:** resolve bundled-dep data reads at runtime ([#311](https://github.com/gjsify/gjsify/issues/311)) ([7dd3b4f](https://github.com/gjsify/gjsify/commit/7dd3b4f00247e4293aabe52812c724da05217b4d)), closes [gjsify/ts-for-gir#392](https://github.com/gjsify/ts-for-gir/issues/392)

## [0.4.25](https://github.com/gjsify/gjsify/compare/v0.4.24...v0.4.25) (2026-05-25)

### Features

* **website:** embed live Adwaita-window demos on showcase sub-pages ([#307](https://github.com/gjsify/gjsify/issues/307)) ([3931a0d](https://github.com/gjsify/gjsify/commit/3931a0ddab02a0350f73f8957d88902401cb333e))

### Bug Fixes

* **install:** actionable Yarn-PnP guard guidance ([#310](https://github.com/gjsify/gjsify/issues/310)) ([af68b52](https://github.com/gjsify/gjsify/commit/af68b5224e7bc756632c1693f50da64be3fea107)), closes [gjsify/ts-for-gir#392](https://github.com/gjsify/ts-for-gir/issues/392) [gjsify/ts-for-gir#392](https://github.com/gjsify/ts-for-gir/issues/392)

## 0.4.24 (2026-05-24)

### Bug Fixes

* **webgl:** close 2 deferred items (multi-FBO texture detach + MAX_RENDERBUFFER cache) ([#300](https://github.com/gjsify/gjsify/issues/300)) ([722a20f](https://github.com/gjsify/gjsify/commit/722a20fbae27bdf56a13851d994499d78f405379))

## [0.4.23](https://github.com/gjsify/gjsify/compare/v0.4.22...v0.4.23) (2026-05-24)

### Bug Fixes

* **pack:** isolate lifecycle-script stdout from --json output ([#298](https://github.com/gjsify/gjsify/issues/298)) ([ef91f0c](https://github.com/gjsify/gjsify/commit/ef91f0c1d5739e029fb2b07c9d5c5a03a2571c5c)), closes [#272](https://github.com/gjsify/gjsify/issues/272)

## [0.4.22](https://github.com/gjsify/gjsify/compare/v0.4.21...v0.4.22) (2026-05-23)

### Features

* **cli:** Flathub-ready Flatpak scaffold for @gjsify/cli ([#267](https://github.com/gjsify/gjsify/issues/267)) ([28573c1](https://github.com/gjsify/gjsify/commit/28573c181d6ec985b20559ad1f6bc71dd3205318))
* **cli:** new `gjsify check` — workspace TS-check orchestrator ([#256](https://github.com/gjsify/gjsify/issues/256)) ([3fd81a8](https://github.com/gjsify/gjsify/commit/3fd81a8916238694e10955e5ce0a67561ede44d3)), closes [#254](https://github.com/gjsify/gjsify/issues/254)
* **cli:** pack honors npm-style lifecycle scripts (prepack/prepublishOnly) ([#272](https://github.com/gjsify/gjsify/issues/272)) ([7c65735](https://github.com/gjsify/gjsify/commit/7c65735d4149784c875971aa53d0187009c9f4f0))
* **install:** --backend=native|npm flag (closes Phase-4 follow-up) ([#274](https://github.com/gjsify/gjsify/issues/274)) ([71c15cb](https://github.com/gjsify/gjsify/commit/71c15cb6fece7863cceed778d49c46654420cb3d))
* **tls:** re-export parseOcspResponse from @gjsify/tls-native ([#253](https://github.com/gjsify/gjsify/issues/253)) ([e5aa676](https://github.com/gjsify/gjsify/commit/e5aa6760cff219e2351326b9b7acc196ed3c41b6))
* **website:** Adwaita coverage redesign — accordion API sections + bridges/tests grids ([#281](https://github.com/gjsify/gjsify/issues/281)) ([369a257](https://github.com/gjsify/gjsify/commit/369a257754de6bdf79aad4341cece0ca28709248))
* **website:** coverage bars — STATUS.md Summary as visual progress bars ([#258](https://github.com/gjsify/gjsify/issues/258)) ([4a49d9e](https://github.com/gjsify/gjsify/commit/4a49d9eb47ba7a10ed6f474db5d57929e0822ad7))
* **website:** pillar coverage progress bars from STATUS.md ([#295](https://github.com/gjsify/gjsify/issues/295)) ([ff3ee5f](https://github.com/gjsify/gjsify/commit/ff3ee5f817c7bae80708e5030e0cb25d85482887))
* **website:** showcase pages — index + 7 per-showcase deep-dives ([#269](https://github.com/gjsify/gjsify/issues/269)) ([c8ef0b2](https://github.com/gjsify/gjsify/commit/c8ef0b2ad1829cf97f0aea4e303a6eec45ab71f3))

### Bug Fixes

* **cli:** dlx — forward extra args after `--` to the bundle ([#259](https://github.com/gjsify/gjsify/issues/259)) ([47fc8af](https://github.com/gjsify/gjsify/commit/47fc8af81327a103b05e803d4c0acb482f2a7d91))
* **fs:** FileHandle.pull() + writer() stubs for Node 25.9+ types compat ([#280](https://github.com/gjsify/gjsify/issues/280)) ([c52cb7b](https://github.com/gjsify/gjsify/commit/c52cb7b8ed10aa37f65fdcf6d21bdc7ee9191cba))
* **rolldown-plugin-gjsify:** auto-detect crypto in wasm-bindgen bundles ([#278](https://github.com/gjsify/gjsify/issues/278)) ([cb474f3](https://github.com/gjsify/gjsify/commit/cb474f3821ed40dbc4a9753a86c4833736b19936)), closes [#277](https://github.com/gjsify/gjsify/issues/277)
* **rolldown-plugin:** inline-static-reads must not evaluate foreign .join ([#282](https://github.com/gjsify/gjsify/issues/282)) ([789109e](https://github.com/gjsify/gjsify/commit/789109ede5a320e07d24d04861c029db2a31259f))



## [0.4.21](https://github.com/gjsify/gjsify/compare/v0.4.20...v0.4.21) (2026-05-22)

### Features

* **cli:** --tolerate-untrusted-new for first-publish Trusted Publisher gap ([#246](https://github.com/gjsify/gjsify/issues/246)) ([fb3034a](https://github.com/gjsify/gjsify/commit/fb3034a2058d0bcfb05a600b44cb8f0ee8bd9f17)), closes [#242](https://github.com/gjsify/gjsify/issues/242)
* **website:** "Three worlds, one runtime" homepage section ([#244](https://github.com/gjsify/gjsify/issues/244)) ([4735e21](https://github.com/gjsify/gjsify/commit/4735e21396abe51b4959652f83c71d44371fa378))

### Bug Fixes

* **cli:** read version from package.json adjacent to bundle (--version) ([#243](https://github.com/gjsify/gjsify/issues/243)) ([d72d403](https://github.com/gjsify/gjsify/commit/d72d40369ce64c9b50e3858d292d7cfbde088100))
* **cli:** resolve bare-name specs to `latest` dist-tag, not semver `*` ([#249](https://github.com/gjsify/gjsify/issues/249)) ([2337a19](https://github.com/gjsify/gjsify/commit/2337a19fe10649a0c2013d22e6b0b969f1a9dfd2))
* **fs:** close Gio.FileEnumerator in readdirSync to avoid EMFILE on deep recursion ([#248](https://github.com/gjsify/gjsify/issues/248)) ([7e307a8](https://github.com/gjsify/gjsify/commit/7e307a8386efbaeb2b66c16820e3c5916dc20ff6))

## [0.4.20](https://github.com/gjsify/gjsify/compare/v0.4.19...v0.4.20) (2026-05-21)

### Features

* **tls-native:** @gjsify/tls-native Phase 1 — OCSP-response parsing ([#242](https://github.com/gjsify/gjsify/issues/242)) ([ca4b0aa](https://github.com/gjsify/gjsify/commit/ca4b0aa5594612e3fb5a5761adcb9b96ea4af865))

### Bug Fixes

* **cli:** pass orchestrator resolve+treeshake to --globals auto analysis ([#239](https://github.com/gjsify/gjsify/issues/239)) ([6fd6b70](https://github.com/gjsify/gjsify/commit/6fd6b70860f176d6b28d737e180c4005bf708c40)), closes [#222](https://github.com/gjsify/gjsify/issues/222)
* **dom-elements:** real ResizeObserver — fire on bridge GTK resizes ([#245](https://github.com/gjsify/gjsify/issues/245)) ([d10d1a5](https://github.com/gjsify/gjsify/commit/d10d1a51aec7294a39e5c3be89171296f73a63bb))

## [0.4.19](https://github.com/gjsify/gjsify/compare/v0.4.18...v0.4.19) (2026-05-21)

### Bug Fixes

* **child_process:** set STDIN_INHERIT for stdio:'inherit', not just NONE ([#234](https://github.com/gjsify/gjsify/issues/234)) ([6bfb49e](https://github.com/gjsify/gjsify/commit/6bfb49ef96d0510ac6d255a2f123c54b12a6160a))
* **cli:** default FORCE_COLOR=1 for spawned scripts ([#235](https://github.com/gjsify/gjsify/issues/235)) ([7c8c721](https://github.com/gjsify/gjsify/commit/7c8c7212dc7b0d9e7caab0cdc9f7d28a26c8c0a2)), closes [#226](https://github.com/gjsify/gjsify/issues/226) [#228](https://github.com/gjsify/gjsify/issues/228)
* **cli:** tolerate 403 + "previously published" body in --tolerate-republish ([#240](https://github.com/gjsify/gjsify/issues/240)) ([7c395ec](https://github.com/gjsify/gjsify/commit/7c395ec7f74477c2d91451e148824bbc188d702d))
* **release-it:** preRelease=false so /releases/latest resolves correctly ([#237](https://github.com/gjsify/gjsify/issues/237)) ([0398334](https://github.com/gjsify/gjsify/commit/039833423bc91678b083033d7f8e5695144aa0e9))
* **release:** drop actions/setup-node registry-url for OIDC mode ([#236](https://github.com/gjsify/gjsify/issues/236)) ([8f51713](https://github.com/gjsify/gjsify/commit/8f5171302766df38fb756107e33081cf94b7718c)), closes [#230](https://github.com/gjsify/gjsify/issues/230)

## [0.4.18](https://github.com/gjsify/gjsify/compare/v0.4.17...v0.4.18) (2026-05-20)

## [0.4.17](https://github.com/gjsify/gjsify/compare/v0.4.16...v0.4.17) (2026-05-20)

### Bug Fixes

* **cli:** bake GI_TYPELIB_PATH/LD_LIBRARY_PATH into launchers + full terminal width ([#226](https://github.com/gjsify/gjsify/issues/226)) ([0fc6c58](https://github.com/gjsify/gjsify/commit/0fc6c5870ca5bbb57e28fb6ea1cfb752d21aed5d))

## [0.4.16](https://github.com/gjsify/gjsify/compare/v0.4.15...v0.4.16) (2026-05-20)

### Features

* **child_process, stream:** async spawn() stdin-piping + Writable _destroy subclass-override fix ([#220](https://github.com/gjsify/gjsify/issues/220)) ([cae47c6](https://github.com/gjsify/gjsify/commit/cae47c690e8781b0d48ea4f3f611d85c57629ffc))
* **cli:** gjsify publish --trusted (npm Trusted Publishing via OIDC) ([#230](https://github.com/gjsify/gjsify/issues/230)) ([7747851](https://github.com/gjsify/gjsify/commit/7747851af65662cd51621f40631c18f788d0ac4e))
* **npm-registry:** retry-with-backoff on transient fetch errors ([#224](https://github.com/gjsify/gjsify/issues/224)) ([c788471](https://github.com/gjsify/gjsify/commit/c78847144f60d02bcdea236bb38d5b9becbf8a11))
* **showcases:** promote webrtc-video example to showcases/dom/ ([#221](https://github.com/gjsify/gjsify/issues/221)) ([87b900e](https://github.com/gjsify/gjsify/commit/87b900ea0c548c7adb5210f25816a260ced39baf)), closes [#215](https://github.com/gjsify/gjsify/issues/215) [#215](https://github.com/gjsify/gjsify/issues/215)
* **tls:** real server-side SNI selection via ClientHello peek-and-parse ([#223](https://github.com/gjsify/gjsify/issues/223)) ([3ced93e](https://github.com/gjsify/gjsify/commit/3ced93e801dcd77cc0a4cf1e47559fcfa8908eec))

### Bug Fixes

* **examples:** mark cli-axios-http-client as private (AGENTS.md convention) ([#225](https://github.com/gjsify/gjsify/issues/225)) ([46e1cfd](https://github.com/gjsify/gjsify/commit/46e1cfd8db2892e9c9911c22309320fa13eb625c))
* **rolldown-plugin-gjsify:** restore npm-package [@import](https://github.com/import) resolution in css-as-string ([#227](https://github.com/gjsify/gjsify/issues/227)) ([9e142a9](https://github.com/gjsify/gjsify/commit/9e142a908392283934949f0059e81e12154d105c))

## [0.4.15](https://github.com/gjsify/gjsify/compare/v0.4.14...v0.4.15) (2026-05-20)

### Features

* **cli:** gjsify barrels — index.ts generator (barrelsby replacement) ([#219](https://github.com/gjsify/gjsify/issues/219)) ([d7456e4](https://github.com/gjsify/gjsify/commit/d7456e40e5cf02b93308ff1e2428194110685b86))
* Phase D-1 execa integration tests + uncover 3 GJS gaps ([#218](https://github.com/gjsify/gjsify/issues/218)) ([c5d4662](https://github.com/gjsify/gjsify/commit/c5d466214f332a77410e1676ccc5354b97e2b705))
* **showcases:** minimalist-browser — IFrameBridge + postMessage cross-variant ([#217](https://github.com/gjsify/gjsify/issues/217)) ([a88f4ac](https://github.com/gjsify/gjsify/commit/a88f4ac52a3fa98ee5cc73eec0bedaaa8c13bc0b))
* **showcases:** promote webrtc-loopback example to showcases/dom/ ([#215](https://github.com/gjsify/gjsify/issues/215)) ([7413f46](https://github.com/gjsify/gjsify/commit/7413f4648c35738d18d43d75dd80881efef984ac))
* **worker_threads:** cross-process MessagePort transfer via SubprocessPortTransport ([#216](https://github.com/gjsify/gjsify/issues/216)) ([92f92c5](https://github.com/gjsify/gjsify/commit/92f92c5b91125ca6460d08ee5b2896ecff37d5cf)), closes [#204](https://github.com/gjsify/gjsify/issues/204) [#198](https://github.com/gjsify/gjsify/issues/198) [#204](https://github.com/gjsify/gjsify/issues/204)

## [0.4.14](https://github.com/gjsify/gjsify/compare/v0.4.13...v0.4.14) (2026-05-19)

### Features

* **buffer, sab-native:** Buffer.from(SharedBuffer) ergonomic interop ([#209](https://github.com/gjsify/gjsify/issues/209)) ([430610c](https://github.com/gjsify/gjsify/commit/430610c7ef5893b689db0d4a43d6f810e65f3ced))
* **cli:** Phase F.10.{2,3} — gjsify flatpak diff + release ([#208](https://github.com/gjsify/gjsify/issues/208)) ([77a99cc](https://github.com/gjsify/gjsify/commit/77a99cc179d85c5fe9b2c12fec899a8e7617532d))
* **cli:** Phase F.10.1 — gjsify flatpak sync-flathub ([#203](https://github.com/gjsify/gjsify/issues/203)) ([1b8e0e3](https://github.com/gjsify/gjsify/commit/1b8e0e345500470f357edf43d3eb8fbe17e3043c))
* **cli:** Phase G.1 — gjsify format / lint / fix (biome native-spawn) + recommended biome.json defaults ([#200](https://github.com/gjsify/gjsify/issues/200)) ([bb82791](https://github.com/gjsify/gjsify/commit/bb82791b1c136bf707d7121e5f57c554ab55cc92))
* **cli:** Phase G.2 — flatpak init 2-space JSON + optional biome-aware post-format ([#201](https://github.com/gjsify/gjsify/issues/201)) ([9f0ac93](https://github.com/gjsify/gjsify/commit/9f0ac9344e090555b723471232cce810814c94be)), closes [package.json#devDependencies](https://github.com/gjsify/package.json/issues/devDependencies)
* **cli:** Phase G.3 — gjsify build --watch ([#205](https://github.com/gjsify/gjsify/issues/205)) ([9930043](https://github.com/gjsify/gjsify/commit/9930043bcab27d65c3925ff1ac5264d1ad6dfc28))
* **cli:** Phase G.4 — gjsify test runner ([#207](https://github.com/gjsify/gjsify/issues/207)) ([0fc1983](https://github.com/gjsify/gjsify/commit/0fc198348f4e9d5badbe56256ff2909c45e6d45a))
* **cli:** Phase G.5 — gjsify upgrade (yarn upgrade-interactive / ncu replacement) ([#213](https://github.com/gjsify/gjsify/issues/213)) ([df6f8ef](https://github.com/gjsify/gjsify/commit/df6f8efe6d7359c6e396cf7654ba0444ba25e228))
* **worker_threads:** compose MessagePort over @gjsify/message-channel ([#204](https://github.com/gjsify/gjsify/issues/204)) ([22f9ba5](https://github.com/gjsify/gjsify/commit/22f9ba5702fef5cecd0242628341aa0800448988))

## [0.4.13](https://github.com/gjsify/gjsify/compare/v0.4.12...v0.4.13) (2026-05-18)

### Features

* **iframe:** consume @gjsify/message-channel for MessagePort transferList ([#198](https://github.com/gjsify/gjsify/issues/198)) ([03a5836](https://github.com/gjsify/gjsify/commit/03a58362708f82836dc5374ba41fb62ab2a767e2)), closes [#196](https://github.com/gjsify/gjsify/issues/196) [#196](https://github.com/gjsify/gjsify/issues/196)

### Bug Fixes

* **cli:** flatpak init — gjsify.flatpak.name overrides display-name derivation ([#199](https://github.com/gjsify/gjsify/issues/199)) ([cd255e8](https://github.com/gjsify/gjsify/commit/cd255e841cb6569951586694d580e9d1371e357f))

## [0.4.12](https://github.com/gjsify/gjsify/compare/v0.4.11...v0.4.12) (2026-05-18)

### Features

* **cli:** Phase F.9 — flatpak init Flathub asset scaffold + check ([#194](https://github.com/gjsify/gjsify/issues/194)) ([910230e](https://github.com/gjsify/gjsify/commit/910230ea337b4f38bdc23a3059ca25eedfd4aff3))
* **iframe:** binary postMessage + W3C origin checks + bootstrap idempotency + MessagePort transferList ([#195](https://github.com/gjsify/gjsify/issues/195)) ([efa096e](https://github.com/gjsify/gjsify/commit/efa096e1a3622e2e93802bd055ab7b03a6407a34))
* **message-channel:** @gjsify/message-channel — W3C MessageChannel + MessagePort globals ([#196](https://github.com/gjsify/gjsify/issues/196)) ([3da7dca](https://github.com/gjsify/gjsify/commit/3da7dca9cb29fed85a00452bdfa9cc5ee92784f1)), closes [#195](https://github.com/gjsify/gjsify/issues/195) [#195](https://github.com/gjsify/gjsify/issues/195)
* **sab-native:** Vala bridge for cross-process shared memory + atomics ([#190](https://github.com/gjsify/gjsify/issues/190)) ([79707e4](https://github.com/gjsify/gjsify/commit/79707e4c746a2f4dd70ab1f45231f3d2478ed7fd))
* **worker_threads:** cross-process SharedBuffer transfer via @gjsify/sab-native ([#193](https://github.com/gjsify/gjsify/issues/193)) ([1bc1dd7](https://github.com/gjsify/gjsify/commit/1bc1dd78912f5217f5251140d2c177d87867500b))

## [0.4.11](https://github.com/gjsify/gjsify/compare/v0.4.10...v0.4.11) (2026-05-18)

### Features

* **cli:** Phase F.8 — gjsify uninstall -g <pkg> ([#189](https://github.com/gjsify/gjsify/issues/189)) ([8b68faa](https://github.com/gjsify/gjsify/commit/8b68faae7ce94bc2568e7d5942668c16fb28fdd4))

### Bug Fixes

* **ci:** release.yml needs contents:write to upload GH release assets ([#187](https://github.com/gjsify/gjsify/issues/187)) ([ecb897d](https://github.com/gjsify/gjsify/commit/ecb897d10d116fff71cf02c69c19a845fd41cabd))

## [0.4.10](https://github.com/gjsify/gjsify/compare/v0.4.9...v0.4.10) (2026-05-17)

### Features

* **cli:** Phase F MVP — Node-free install.mjs bootstrap + self-update + generate-installer ([#186](https://github.com/gjsify/gjsify/issues/186)) ([7a0e27c](https://github.com/gjsify/gjsify/commit/7a0e27ce7f13d479eb3b6684d45ee24ef170a9a0))
* **web-streams:** ReadableByteStreamController + BYOB reader (W3C Streams) ([ff4da81](https://github.com/gjsify/gjsify/commit/ff4da8130ee1d65ca487e31111fe3afa0823abc7))

## [0.4.9](https://github.com/gjsify/gjsify/compare/v0.4.8...v0.4.9) (2026-05-17)

### Bug Fixes

* **cli:** gjsify publish — honor NPM_CONFIG_USERCONFIG for npmrc lookup ([1440946](https://github.com/gjsify/gjsify/commit/1440946e2593d69e173770b834906b1811f3a8ee))

## [0.4.8](https://github.com/gjsify/gjsify/compare/v0.4.7...v0.4.8) (2026-05-17)

### Bug Fixes

* **cli:** gjsify publish — match npm-package-arg URL encoding + add debug ([b0ec386](https://github.com/gjsify/gjsify/commit/b0ec386fde2b2d9bb2dc80dbca5b70c1d1fe6b09))

## [0.4.7](https://github.com/gjsify/gjsify/compare/v0.4.6...v0.4.7) (2026-05-17)

### Bug Fixes

* **cli:** gjsify publish — use unscoped basename in wire filename ([98bb7f9](https://github.com/gjsify/gjsify/commit/98bb7f92cf15220775b779f0dd4bb3c3949d8220))

## [0.4.6](https://github.com/gjsify/gjsify/compare/v0.4.5...v0.4.6) (2026-05-17)

### Features

* **cli:** Phase E — gjsify pack + gjsify publish (drop npm publish/pack) ([3a8de65](https://github.com/gjsify/gjsify/commit/3a8de6515289eb83c20292dc0e07a035b949039d))

## [0.4.5](https://github.com/gjsify/gjsify/compare/v0.4.4...v0.4.5) (2026-05-17)

### Features

* **cli:** support npm overrides + yarn resolutions in gjsify install ([611f1ac](https://github.com/gjsify/gjsify/commit/611f1ac42079ccca86299f21a8180b4d54959d5d))

## [0.4.4](https://github.com/gjsify/gjsify/compare/v0.4.3...v0.4.4) (2026-05-17)

### Features

* **http2-native:** full nghttp2 session bridge (Phase 0) ([3a6fe6c](https://github.com/gjsify/gjsify/commit/3a6fe6c21164174b3748daaddf9bf6366a608b08))
* **http2:** client-side native session + server push reception (Phase 3) ([75b48de](https://github.com/gjsify/gjsify/commit/75b48de49332dadf2d3d5aa7879ef63805ad0655))
* **http2:** hardening — GOAWAY, RST_STREAM, GC pinning (Phase 4) ([e03eb2b](https://github.com/gjsify/gjsify/commit/e03eb2b0980abb297832b7fd1dba97565afe1fa0))
* **http2:** native h2c dispatcher on Gio.SocketService (Phase 1) ([cbdc0e2](https://github.com/gjsify/gjsify/commit/cbdc0e2a73893c77a210fcc2b2eba6d5049574f7))
* **http2:** PUSH_PROMISE wire delivery (Phase 2) ([3fcd03e](https://github.com/gjsify/gjsify/commit/3fcd03eef27e97e94cc9607405634fcded44cdc3))

### Bug Fixes

* **cli,scripts:** publish-workspace + run.ts script-vs-file precedence ([302c97a](https://github.com/gjsify/gjsify/commit/302c97aa8a50a3506a279db0c4629f7a7f2247e6))

## [0.4.3](https://github.com/gjsify/gjsify/compare/v0.4.2...v0.4.3) (2026-05-16)

### Features

* **cli:** gjsify foreach --exec mode for arbitrary commands ([9e5ffbd](https://github.com/gjsify/gjsify/commit/9e5ffbd5e3441043cc0d38a33853efbadc6bd5a2))

## [0.4.2](https://github.com/gjsify/gjsify/compare/v0.4.1...v0.4.2) (2026-05-16)

### Bug Fixes

* **cli:** workspace/foreach/run walk up to monorepo root ([e94d823](https://github.com/gjsify/gjsify/commit/e94d823490bc180941930af210f1aceb7823365e))
* **website:** replace remaining yarn refs in scripts with gjsify ([9758cf9](https://github.com/gjsify/gjsify/commit/9758cf95099e876d10a1ad90c7d9de5d83c2b08d))

## [0.4.1](https://github.com/gjsify/gjsify/compare/v0.4.0...v0.4.1) (2026-05-16)

### Features

* **cli:** Phase D.7b — install backend nested-node_modules ([#177](https://github.com/gjsify/gjsify/issues/177)) ([becfbea](https://github.com/gjsify/gjsify/commit/becfbea666a62c53fbd4c2199827dea118c14d14))
* **monorepo:** Phase D.7c — CI bootstraps via gjsify install (yarn install removed) ([#178](https://github.com/gjsify/gjsify/issues/178)) ([510a296](https://github.com/gjsify/gjsify/commit/510a2962c114841f0ade614499599a6292029cee)), closes [#170](https://github.com/gjsify/gjsify/issues/170) [#177](https://github.com/gjsify/gjsify/issues/177)
* **monorepo:** Phase D.7d — drop yarn entirely from the gjsify monorepo ([#179](https://github.com/gjsify/gjsify/issues/179)) ([df2c038](https://github.com/gjsify/gjsify/commit/df2c038481eea1d77901bb6f2e148b8eb8f67b09))

## [0.4.0](https://github.com/gjsify/gjsify/compare/v0.3.21...v0.4.0) (2026-05-13)

### Features

* **child_process:** honour {signal} option in spawn ([771f7cf](https://github.com/gjsify/gjsify/commit/771f7cf59cf562a43b9064c06cf3ee455c12b3b5))
* **cli:** Phase A — top-level keepNames replaces nested minify shape ([#158](https://github.com/gjsify/gjsify/issues/158)) ([4db88bd](https://github.com/gjsify/gjsify/commit/4db88bded397a0dfeb49f2e69266a39a612a078b))
* **cli:** Phase D-2.B.5b — gjsify build CLI wire-up to native rolldown ([#150](https://github.com/gjsify/gjsify/issues/150)) ([ae1fee0](https://github.com/gjsify/gjsify/commit/ae1fee053f95a2ed6183489970cee61d62f454df))
* **cli:** Phase D-3.1 — bundler-pick defaults to native under GJS ([#156](https://github.com/gjsify/gjsify/issues/156)) ([5791351](https://github.com/gjsify/gjsify/commit/579135176d00799635d9790c597b6ee8b67ffb11))
* **cli:** Phase D-3.2/3.3 — gjsify CLI runs under GJS + bundles ESM projects ([#157](https://github.com/gjsify/gjsify/issues/157)) ([b64c6eb](https://github.com/gjsify/gjsify/commit/b64c6eb45da2d3fada37f3d57d6c51eb214cc4b1))
* **cli:** Phase D.1 — project-local install via native backend ([#161](https://github.com/gjsify/gjsify/issues/161)) ([36aebe9](https://github.com/gjsify/gjsify/commit/36aebe9184f20b1363cb88f95aece2d5d38169bb))
* **cli:** Phase D.3 — workspace-aware gjsify install ([#163](https://github.com/gjsify/gjsify/issues/163)) ([68f9f96](https://github.com/gjsify/gjsify/commit/68f9f96702b9ec925cd9a8346fb3921c0a20fd29))
* **cli:** Phase D.4 — gjsify foreach + gjsify workspace commands ([#167](https://github.com/gjsify/gjsify/issues/167)) ([6a025d5](https://github.com/gjsify/gjsify/commit/6a025d5238320b83e0ee7a7497e995f20c853fdd))
* **cli:** Phase D.5 — gjsify run dual-mode script-runner ([#165](https://github.com/gjsify/gjsify/issues/165)) ([dfd8fbf](https://github.com/gjsify/gjsify/commit/dfd8fbf83a36c3b48c3f3143dc00080331a8942e))
* **cli:** Phase D.6 — gjsify install --immutable CI mode ([#166](https://github.com/gjsify/gjsify/issues/166)) ([4523181](https://github.com/gjsify/gjsify/commit/452318105a0841967d3fa4638a56ba2bb625c202))
* **cli:** Phase D.7b.1 — committed GJS bundle + gjsify.bin distribution ([#170](https://github.com/gjsify/gjsify/issues/170)) ([8d68bf9](https://github.com/gjsify/gjsify/commit/8d68bf9a50ce02a9c56fdf8e9f9675ec3c3805ae))
* **flatpak:** Phase B — drop Node24 SDK extension from default manifest ([#159](https://github.com/gjsify/gjsify/issues/159)) ([248e99b](https://github.com/gjsify/gjsify/commit/248e99b3216fcb85ea99584003b152dffda3d975))
* **http2-native:** introduce nghttp2 Vala bridge ([6d2ceb3](https://github.com/gjsify/gjsify/commit/6d2ceb3f16c64a9fe6a8989fcf27a4a357b50625))
* **http2:** server push + respondWithFD/File via @gjsify/http2-native ([581a19a](https://github.com/gjsify/gjsify/commit/581a19afb59e19976556e3c7289643b8318a62d4))
* **lightningcss-native:** Phase D-2 POC — Vala+Rust cdylib bridge to lightningcss ([#133](https://github.com/gjsify/gjsify/issues/133)) ([42201ad](https://github.com/gjsify/gjsify/commit/42201ad3141f8412b8bfe944ec91431aeab14aa0))
* **lightningcss-wasm:** Phase D-2 POC — WASM track via napi-wasm ([#134](https://github.com/gjsify/gjsify/issues/134)) ([4a494d4](https://github.com/gjsify/gjsify/commit/4a494d4f259acd8019795a783b2ba3eb6616b78a)), closes [#133](https://github.com/gjsify/gjsify/issues/133) [#132](https://github.com/gjsify/gjsify/issues/132)
* **module:** Phase C — createRequire honors pkg.exports map ([#160](https://github.com/gjsify/gjsify/issues/160)) ([e51b126](https://github.com/gjsify/gjsify/commit/e51b126724180f8e0346efa7883e2777858c0986)), closes [#157](https://github.com/gjsify/gjsify/issues/157)
* **monorepo:** Phase D.7a — root scripts migrated from yarn to gjsify ([#168](https://github.com/gjsify/gjsify/issues/168)) ([33097c4](https://github.com/gjsify/gjsify/commit/33097c4aa94b7754df0b7f7bcdb2f13d72028048))
* **rolldown-native:** Phase D-2 POC — Vala+Rust cdylib bridge to rolldown ([#136](https://github.com/gjsify/gjsify/issues/136)) ([6149b76](https://github.com/gjsify/gjsify/commit/6149b76793a75f21ea55f58c112843f840f940c3)), closes [#133](https://github.com/gjsify/gjsify/issues/133)
* **rolldown-native:** Phase D-2.B.1 — plugin-bridge skeleton (load hook) ([#140](https://github.com/gjsify/gjsify/issues/140)) ([8402b1c](https://github.com/gjsify/gjsify/commit/8402b1cfc6f619b2ec32f3a3000912d6332db3c1)), closes [#136](https://github.com/gjsify/gjsify/issues/136)
* **rolldown-native:** Phase D-2.B.2 — all 12 hooks + per-hook id regex filter ([#141](https://github.com/gjsify/gjsify/issues/141)) ([abd0566](https://github.com/gjsify/gjsify/commit/abd0566ee2f9432a32afe0f3e508ebaff0fc4378)), closes [#1346](https://github.com/gjsify/gjsify/issues/1346)
* **rolldown-native:** Phase D-2.B.3 — nested protocol for plugin-context callbacks ([#147](https://github.com/gjsify/gjsify/issues/147)) ([e1d5c60](https://github.com/gjsify/gjsify/commit/e1d5c6048374eb931eebcd0669ee720909e20efd))
* **rolldown-native:** Phase D-2.B.4 — zero-copy GBytes payload for transform hook ([#155](https://github.com/gjsify/gjsify/issues/155)) ([beb69c4](https://github.com/gjsify/gjsify/commit/beb69c41b4f32949c43e83da4f0ffe2ed134256c))
* **rolldown-native:** Phase D-2.B.5a — bundleWithPlugins() TS facade ([#148](https://github.com/gjsify/gjsify/issues/148)) ([f3f0084](https://github.com/gjsify/gjsify/commit/f3f0084eae057f49899f4865001418dac0ec96a6))
* **rolldown-plugin-gjsify:** cssAsStringPlugin prefers @gjsify/lightningcss-native ([#137](https://github.com/gjsify/gjsify/issues/137)) ([a25eb78](https://github.com/gjsify/gjsify/commit/a25eb7875bf2cf9966227d5fc138de5e89cfb7f4))
* **tls:** cert-chain, mTLS, SNI server, ALPN, RFC 6125 checkServerIdentity ([2b259b7](https://github.com/gjsify/gjsify/commit/2b259b7e61611d694bfcc46693882d3745bd13eb))
* **util:** add aborted(signal, resource) — Node 19+ stable API ([a7ab491](https://github.com/gjsify/gjsify/commit/a7ab491004483db122b03967ad92a3530522d5ab))
* **worker_threads:** transferList for ArrayBuffer + MessagePort, SAB pass-through ([54a5260](https://github.com/gjsify/gjsify/commit/54a5260db2b3fa896afcd92cb87f8108597518ed))
* **workspace:** Phase D.2 — @gjsify/workspace package ([#162](https://github.com/gjsify/gjsify/issues/162)) ([bfacd13](https://github.com/gjsify/gjsify/commit/bfacd13b65413f1eb411d874d04b47e4d8ae51d6))

### Bug Fixes

* **build:** move build:gjs-bundle to root build chain tail ([#171](https://github.com/gjsify/gjsify/issues/171)) ([b57153d](https://github.com/gjsify/gjsify/commit/b57153d4046b286edea3f985a0d9ebe26d77969e))
* **ci:** functional bundle freshness check, not byte-exact ([#175](https://github.com/gjsify/gjsify/issues/175)) ([dd43c24](https://github.com/gjsify/gjsify/commit/dd43c2497023a5a9b0c51ea724dc01ca552e1917))
* **cli:** include showcases.json in npm tarball files allowlist ([#176](https://github.com/gjsify/gjsify/issues/176)) ([b522c0c](https://github.com/gjsify/gjsify/commit/b522c0c5f5aebe9c45ab71f8062636612c7bc72c)), closes [#170](https://github.com/gjsify/gjsify/issues/170)
* **monorepo:** add @gjsify/cli to root devDependencies — gives root scripts access to `gjsify` binary ([#172](https://github.com/gjsify/gjsify/issues/172)) ([618614c](https://github.com/gjsify/gjsify/commit/618614c711817bddebc313942e610ed2df661bc7))
* **monorepo:** revert `clear` + `clear:examples` to yarn — pre-build ordering ([#169](https://github.com/gjsify/gjsify/issues/169)) ([fcc799d](https://github.com/gjsify/gjsify/commit/fcc799dfedc8e1037a096a3f1c39813573ecf459)), closes [#168](https://github.com/gjsify/gjsify/issues/168)
* **timers:** add scheduler API to node:timers/promises ([3eac808](https://github.com/gjsify/gjsify/commit/3eac8082feea2f596469256eb899b087e7d8dd92))
* **yarn.lock:** align with latest main after [#122](https://github.com/gjsify/gjsify/issues/122) merge ([5390ad8](https://github.com/gjsify/gjsify/commit/5390ad8405e63afc490818cf899ce4405d101cab))
* **yarn.lock:** regenerate after Phase D-1 Batch 1 merges ([179ae4f](https://github.com/gjsify/gjsify/commit/179ae4f2d577093b5a4c1d238dfd15b3a0285412)), closes [#117](https://github.com/gjsify/gjsify/issues/117) [#118](https://github.com/gjsify/gjsify/issues/118) [#119](https://github.com/gjsify/gjsify/issues/119) [#120](https://github.com/gjsify/gjsify/issues/120) [#120](https://github.com/gjsify/gjsify/issues/120) [#121](https://github.com/gjsify/gjsify/issues/121)

## Unreleased

### Goals

* **Phase D — gjsify Self-Hosting auf GJS (2026-05-09):** new long-term goal
  raised by the user — the entire gjsify toolchain (`gjsify build`/`run`/
  `install`/`create`/`dlx`/`showcase`/`flatpak`) should run on GJS itself,
  no Node.js anywhere. Subsumes the earlier "Node-free build chain" goal
  and pushes it through to a complete self-hosting story. Sub-phases:
  **D-1 (in progress)** — integration tests for every npm runtime dep of
  `packages/infra/*` (10 streams: yargs, acorn, fast-glob, gettext-parser,
  cosmiconfig, execa, pkg-types+get-tsconfig, @rollup/pluginutils,
  @deepkit/type-compiler, minify-xml — fix-in-PR-by-default policy);
  **D-2 (research)** — replacement strategy for the two Rust blockers
  `rolldown` and `lightningcss`; **D-3 (deferred)** — release `gjsify
  install` user CLI + ship CLI bundle for GJS itself + drop
  `Sdk.Extension.node24` from the Flatpak workflow. Anchored in STATUS.md
  `Long-term goal — Phase D` + the per-stream tracker
  `Medium priority — Phase D-1`. Plan file:
  `.claude/plans/erstelle-einen-umsetzungsplan-f-r-fluttering-barto.md`.

### Features

* **Phase D-2.B.4: rolldown-native — zero-copy GBytes payload for the
  transform hook (2026-05-11):** The transform request/response no
  longer JSON-encodes the module's source code. Instead the bytes
  travel out-of-band through a parallel payload slot keyed by
  `req_id`. Same wire-protocol shape for the other 11 hooks — only
  transform changed.

  - **Rust** (`SessionShared` + `plugin_proxy.rs`): two new
    `Mutex<HashMap<u64, Vec<u8>>>` slots — `request_payloads` (Rust
    → JS, drained by JS adapter) and `response_payloads` (JS →
    Rust, popped by the dispatch site after `respond()`). New
    externs `take_request_payload(reqId)`, `set_response_payload
    (reqId, bytes)`, `free_payload(buf, len)`. Transform's
    `HookRequestPayload::Transform` variant dropped the `code:
    String` field and gained a `payload_kind: "code"` marker.
    `HookResponse::into_transform_return_with_bytes(Option<Vec<u8>>)`
    builds the `HookTransformOutput` from response-payload bytes
    when the envelope sets `hasCodeBytes: true`.
  - **Vala bridge**: `BundlerSession.take_request_payload(req_id) →
    GLib.Bytes?` and `set_response_payload(req_id, GLib.Bytes) →
    bool`. C glue copies the Rust-allocated buffer into a GLib
    heap GBytes and frees the Rust side in-place so refcount
    lifetime stays GLib-owned.
  - **TS facade** (`plugins.ts`): `dispatchHook` special-cases
    `'transform'` — fetches `code` bytes via
    `session.take_request_payload(reqId)`, decodes to string, calls
    the user handler unchanged. Result side: new
    `respondTransform()` stashes the output code via
    `set_response_payload` + sets `hasCodeBytes: true` in the
    envelope. Handlers that return `null` skip cleanly (no bytes
    stashed) so the payload-slot lifecycle stays balanced.

  Two new integration specs in `tests/integration/rolldown-native/`
  verify the round-trip: a transform that uppercases a placeholder
  sees the original source via the request-payload path AND its
  modification reaches the bundle via the response-payload path
  (`ORIGINAL` → `TRANSFORMED`), and a no-op transform leaves the
  source intact without stashing response bytes. Brings the suite
  to 9 specs / 38 assertions.

  Plan-estimated 30–50% hook-overhead reduction on 100-module
  bundles; we don't have a 100-module benchmark in-repo yet, so the
  saving is left to be measured once the self-host loop lands real
  CLI builds through this path.

* **Phase D-2.B.6: rolldown-native — integration test suite
  (2026-05-10):** New `tests/integration/rolldown-native/`
  (`@gjsify/integration-rolldown-native`, private). 6 specs / 29
  assertions, all passing under GJS 1.88, exercising the
  `bundleWithPlugins()` facade end-to-end with the full Phase B
  contract surface:
  - all 12 hook positions fire on a single multi-hook plugin (B.2)
  - `idFilter.load` regex short-circuits non-matching ids (B.2)
  - `this.resolve()` re-enters the resolver pipeline (B.3)
  - `this.resolve()` from one plugin triggers another plugin's
    `resolveId` (B.3 re-entrancy)
  - `this.error()` throws synchronously in the JS handler (B.3)
  - rolldown-shaped `{filter, handler}` hooks dispatch correctly
    after `toNativePlugin` translation (B.5b adapter)

  GJS-only because the native bridge needs the GjsifyRolldown
  typelib. Replaces the ad-hoc `/tmp/rolldown-b{2,3,5}-*.js` scripts
  built up across B.1–B.5; permanent regression coverage now lives
  in version control.

  The end-to-end self-host loop the original plan sketched (CLI
  bundles itself for GJS, then bundles a test project, diff vs
  Node-CLI output) needs the gjsify CLI's own runtime portability
  story to land first — tracked separately in STATUS.md "Open TODOs"
  rather than blocking the B-series merges.

* **Phase D-2.B.5b: rolldown-native — `gjsify build` CLI wire-up
  (2026-05-10):** New `packages/infra/cli/src/lib/bundler-pick.ts`
  encapsulates the npm-vs-native engine choice behind a single
  `runBundle(finalOpts) → Promise<RolldownOutput>` helper. The CLI's
  `buildApp()` and `runOneLibraryBuild()` both call it instead of
  `rolldown(opts).write(opts.output)` directly.

  Default behavior is unchanged (npm rolldown). Setting
  `GJSIFY_BUNDLER=native` opts into `@gjsify/rolldown-native` via
  the B.5a `bundleWithPlugins()` facade. Under Node the env var is
  ignored. Under GJS, if the prebuild isn't loadable for the running
  architecture, `runBundle` throws a clear configuration error
  rather than silently falling back.

  Plugin-shape adapter (`toNativePlugin`) translates rolldown's
  per-hook `{filter, handler}` form (and the bare-function form)
  to `NativePlugin` shape. `filter.id` regex/string sources become
  `idFilter.<hook>` regex strings on the Rust side, exercising
  B.2's regex short-circuit. `this.resolve()` / `this.warn()` /
  `this.error()` calls inside hook handlers route through B.3's
  nested protocol. Plugins that depend on rolldown context methods
  the native facade doesn't implement (`this.parse`, `this.emitFile`,
  `this.getModuleInfo`) will fail at hook-call time — the current
  gjsify plugin set doesn't use any of those.

  `@gjsify/cli` declares `@gjsify/rolldown-native` as an optional
  peer dependency so npm consumers without the prebuild aren't
  broken.

  Self-host smoke (B.6) follows next.

* **Phase D-2.B.5a: rolldown-native — `bundleWithPlugins()` TS facade
  (2026-05-10):** New `@gjsify/rolldown-native` export that turns the
  raw `BundlerSession` GObject + signal surface into a single
  `Promise<BundleResult>` call, accepting an array of plugin objects
  with the rolldown-shaped hook signatures (`load`, `transform`,
  `resolveId`, `renderChunk`, `banner`/`footer`/`intro`/`outro`,
  `buildStart`/`buildEnd`, `generateBundle`/`writeBundle`/`closeBundle`)
  plus per-hook `idFilter`. Inside each handler `this` is a
  `NativePluginContext` exposing `resolve()` (Promise-returning,
  routes through B.3's `context_resolve` protocol), `warn(msg)` (B.3
  `context_warn`), and `error(msg)` (pure JS throw, caught at the
  dispatch boundary and converted to a build-failing
  `kind:'error'` response).

  Smoke-tested under GJS 1.88 with a 4-plugin pipeline (alias →
  loader → wrap → lifecycle): `this.resolve('@virtual/loader')` from
  a `transform` hook produces the right id, `this.warn()` shows up
  in `BundleOutputJson.warnings`, `renderChunk` prefix + `banner`
  inject correctly, and the constant `41 + 1` gets folded to `42`.

  Companion CLI wire-up (B.5b) lands in a follow-up PR — that one
  swaps `rolldown(opts)` in `packages/infra/cli/src/actions/build.ts`
  + `packages/infra/rolldown-plugin-gjsify/src/utils/auto-globals.ts`
  for `bundleWithPlugins()` whenever the GJS runtime can load this
  package's prebuild. Splitting the facade off from the CLI swap
  keeps each PR small and the wire-up trivially A/B-testable.

* **Phase D-2.B.3: rolldown-native — nested protocol for plugin-context
  callbacks (2026-05-10):** Adds `BundlerSession.context_resolve()` +
  `context_warn()` methods and a `context_response(child_id,
  response_json)` signal so JS plugin hook handlers can re-enter the
  Rust resolve pipeline mid-await. This unblocks `aliasPlugin`-style
  plugins that call `this.resolve(source, importer)` from inside
  `load`/`transform`/`resolveId` hooks, and `pnpPlugin`-style
  `this.warn(msg)` accumulation into `BundleOutputJson.warnings`.

  `this.error(msg)` stays purely JS-side (handler throws → caught →
  `kind:'error'` response — no FFI needed).

  Implementation:
  - **Rust** (`session.rs` / `plugin_proxy.rs`): new `SessionShared`
    Arc bundles `contexts: HashMap<u64, PluginContext>` +
    `next_child_id: AtomicU64` + `context_response_tx:
    Sender<ContextResolveResponse>` + `context_response_eventfd: c_int`
    + `context_warnings: Mutex<Vec<String>>`. Each load/transform/
    resolveId hook clones its `PluginContext` into the session
    registry keyed by parent `req_id` before dispatching to JS, and
    removes it once the parent's reply arrives or times out. New
    extern `gjsify_rolldown_session_context_resolve(parent_req_id,
    args_json) -> u64 child_id` looks up the parent ctx, spawns a
    fresh tokio task that awaits `ctx.resolve(specifier, importer,
    opts).await`, and writes the result to the
    context-response channel + wakes the eventfd. Cancellation +
    arg-parse errors deliver synthetic `{error}` responses so JS
    awaits never hang.

  - **Vala** (`rolldown.vala`): `BundlerSession` watches a third
    `IOChannel` over `context_response_eventfd`, drains the response
    queue, peeks `childId` via `Json.Parser` and re-emits as
    `context_response(child_id, response_json)`. New methods
    `context_resolve(parent_req_id, args_json) → uint64` and
    `context_warn(message)`.

  - **C glue** (`gjsify-rolldown-glue.{h,c}`): three new wrappers
    around the new Rust externs. New `BundleSession*` API entries in
    `gjsify-rolldown.h` mirror the Rust signatures.

  Two smoke tests pass under GJS 1.88:
  - `ctx.resolve('./other.mjs', importer)` from a `load` hook returns
    `{id: '/tmp/.../other.mjs', external: false}`. `ctx.warn('test')`
    is appended to `BundleOutputJson.warnings`.
  - Re-entrancy: a `load` plugin's `ctx.resolve('@alias/foo', importer)`
    re-enters the resolve pipeline and triggers a different plugin's
    `resolveId` hook. The alias plugin sees the nested call (its
    `resolveId` fires, returns `'/tmp/.../aliased.mjs'`), and the
    load plugin observes the resolved path. Confirms rolldown's
    `skip_self: true` semantics work through our nested-protocol
    surface — the load plugin doesn't recursively trigger its own
    `resolveId`, but other plugins still get to claim the specifier.

* **Phase D-2.B.2: rolldown-native — all 12 hooks + per-hook id regex
  filter (2026-05-10):** Extends the B.1 skeleton from a single
  `load` hook to the complete `Plugin`-trait surface. The Vala
  signal collapsed from one-per-hook into a generic
  `hook_requested(hook_name, req_id, plugin_index, args_json)` —
  JS-side adapters dispatch by `hook_name`. All 12 hooks
  (`load`, `transform`, `resolveId`, `renderChunk`, `banner`,
  `footer`, `intro`, `outro`, `buildStart`, `buildEnd`,
  `generateBundle`, `writeBundle`, `closeBundle`) round-trip
  through Rust → eventfd → Vala → JS → respond → tokio oneshot.

  `PluginMeta.idFilter` adds an optional per-hook regex
  short-circuit (load/transform/resolveId only — the only hooks
  whose primary input is a single `id` string). When set, the
  Rust proxy compiles the regex once at session start and skips
  the JS round-trip whenever the id doesn't match. Mirrors
  rolldown's own `HookFilter.value` short-circuit; full token-tree
  boolean expressions stay JS-side for now and surface via
  `kind:'skip'` responses, which Phase B.4's zero-copy pass will
  optimize.

  Serialization fix: per-variant `#[serde(rename_all = "camelCase")]`
  on `HookRequestPayload` was being dropped by `#[serde(flatten)]`
  in the wire envelope (serde issue #1346). Replaced flatten with
  a manual `serde_json::Value` merge so multi-word fields like
  `moduleType`, `isEntry`, `fileName` reach JS in the documented
  camelCase shape.

  Smoke tests under GJS 1.88: a single multi-hook plugin sees
  `{buildStart:1, resolveId:2, transform:3, load:2, buildEnd:1,
  banner:1, footer:1, renderChunk:1, generateBundle:1}` and the
  final chunk contains the expected stacked contributions
  (renderChunk prefix → banner → body → footer). A two-plugin
  filter test confirms a `{idFilter:{load:'\\.txt$'}}` plugin
  receives only `b.txt` while the no-filter sibling sees both
  `.mjs` modules. Phase B.3 (nested protocol for plugin-context
  methods like `this.resolve`) and B.4 (zero-copy GBytes for the
  transform hook) follow.

* **Phase D-2.B.1: rolldown-native plugin-bridge skeleton (2026-05-10):**
  First proof that bidirectional FFI callbacks for rolldown's plugin
  system work end-to-end across Rust → Vala → JS → respond → Rust.
  Adds `GjsifyRolldown.BundlerSession` GObject class with three
  signals (`load_requested(req_id, plugin_index, args_json)`,
  `completed(output_json)`, `error_occurred(message)`) and three
  methods (`start(args_json)`, `respond(req_id, response_json)`,
  `cancel()`).

  Architecture mirrors `@gjsify/webrtc-native`'s main-thread
  signal-bridge pattern. New Rust modules in
  `packages/infra/rolldown-native/src/rust/src/`:
  - `plugin_proxy.rs` — `JsPluginProxy` implements
    `rolldown_plugin::Plugin`. Each hook call awaits a
    `tokio::sync::oneshot` filled by the JS side via `respond()`.
    `register_hook_usage()` tells rolldown which hooks the proxy
    actually implements so dispatch attempts skip unset ones.
    60-second response timeout prevents hangs.
  - `session.rs` — `BundleSession` owns the multi-threaded tokio
    runtime, the `crossbeam_channel` of pending hook requests, and
    an eventfd-pair (`request_eventfd` for "request available",
    `complete_eventfd` for "build done") that the Vala main loop
    watches.

  Vala bridge (`src/vala/rolldown.vala`) opens GLib `IOChannel`
  watches on the eventfds, parses the request envelope just enough
  to peek `hook` + `reqId` + `pluginIndex` (json-glib), routes to
  the matching signal. Response goes back through
  `gjsify_rolldown_glue_session_respond`.

  Three smoke tests pass under GJS 1.88:
  - load hook returns synthesized code → bundled output contains it
    (`export const synthesized = "from-js-plugin"`)
  - plugin chain `[always-skip, real-loader, never-runs]` → first
    non-null wins, plugin 2 never invoked
  - `{kind:'error', message:'...', stack:'...'}` response →
    rolldown wraps as `UnloadableDependency` BuildDiagnostic, the
    session emits `error_occurred` with the wrapped message

  Phase B.1 wires only the `load` hook end-to-end; the remaining
  11 hooks (transform, resolveId, renderChunk, banner/footer/
  intro/outro, buildStart/End, generateBundle, writeBundle,
  closeBundle) get fanned out in Phase B.2. Plugin-context
  methods (`this.resolve`, `this.error`) come in B.3 via nested
  protocol.

* **integration-lightningcss byte-equality suite (2026-05-10):**
  Phase D-2 follow-up. New `tests/integration/lightningcss/` suite
  (`@gjsify/integration-lightningcss`, private) turns the
  decision-matrix's load-bearing byte-equality property into a
  permanent regression guard. 6 fixtures × 2 backend pairs = 12
  assertions covering all three backends transitively:
    - Node: `@gjsify/lightningcss-wasm` vs npm `lightningcss` (6/6)
    - GJS:  `@gjsify/lightningcss-native` vs `@gjsify/lightningcss-wasm` (6/6)
  Fixtures exercise distinct paths: plain selector, longhand
  collapse, CSS nesting flatten for `firefox >= 60`, `lch()` color
  lowering, pretty-print, nested `@media` flatten. Source maps are
  intentionally NOT part of the contract (mappings indexes
  legitimately differ between backends). Wired into `yarn
  test:integration`.
* **Multi-arch CI prebuilds for lightningcss-native + rolldown-native
  (2026-05-10):** Extended `.github/workflows/prebuilds.yml` so the
  Phase D-2 native packages get prebuilt and committed alongside the
  existing webgl / webrtc-native / http-soup-bridge / http2-native
  ones. Coverage:
  - `lightningcss-native`: linux-{x86_64, aarch64, ppc64, s390x, riscv64}
    (5 arches; pure crates.io deps, no submodule).
  - `rolldown-native`: linux-{x86_64, aarch64} only — the rolldown
    crate graph (~250 transitive crates incl. tokio + oxc) compiles
    in ~5 min on native x86_64 and would blow the 6-hour QEMU job
    timeout under emulation. Multi-arch rolldown waits for either a
    coherent rolldown crates.io publish or cross-compilation via
    `cross`.

  Both jobs install `rustup` (Fedora 43's distro `cargo` is too old
  for `indexmap@2.14`'s `edition2024`). `refs/rolldown` submodule
  initialized in the rolldown-native step. Workflow path-trigger
  expanded to the new packages so source changes auto-trigger
  rebuilds on main.
* **cssAsStringPlugin prefers @gjsify/lightningcss-native (2026-05-10):**
  Phase D-2 wire-up — the plugin's `.css` bundling step now picks its
  backend lazily on first call: under GJS, probe
  `@gjsify/lightningcss-native`'s `hasNativeLightningcss()`; on success
  route through its new `bundle()` method (3-5× faster than the WASM
  track per the decision matrix in `docs/poc/lightningcss-decision.md`).
  On Node or when the native prebuild is unavailable, fall back to
  npm `lightningcss`'s `bundleAsync` (existing behavior — npm
  `lightningcss` stays a regular dep). Backend cached for the rest of
  the build; env override `GJSIFY_CSS_BACKEND={native|npm}` for
  benchmarking + integration suites. Required extending
  `@gjsify/lightningcss-native` with a `bundle()` GObject method on
  top of lightningcss's built-in filesystem `FileProvider` — resolves
  `@import` chains in Rust without ever crossing the FFI boundary,
  mirroring npm `lightningcss`'s `bundleAsync` semantics. Smoke
  tested under GJS 1.88: 0.99 ms cold for a 3-file `@import` bundle
  with nesting-flatten + minify; @import-of-missing-file surfaces a
  clear `os error 2` diagnostic. Existing `tests/e2e/css-bundling/`
  suite still green via the npm path.
* **rolldown-native POC (2026-05-10):** Phase D-2 FFI track for the
  rolldown bundler crate, mirroring `@gjsify/lightningcss-native`.
  Adds `@gjsify/rolldown-native` under `packages/infra/rolldown-native/`:
  Rust shim (`src/rust/`, path-dep on `refs/rolldown` because crates.io
  0.1.0 has broken transitive deps — `rolldown_fs` wants a newer
  `OxcResolverFileSystem` trait surface than the published
  `rolldown_resolver` provides) exposes one
  `extern "C" gjsify_rolldown_bundle(options_json)` that
  deserializes `BundlerOptions` via serde, drives
  `Bundler::generate()` to completion on a per-call current-thread
  tokio runtime, and serializes the BundleOutput as JSON. C glue
  → `GBytes` + `GError`. Vala wrapper exposes
  `GjsifyRolldown.Bundler.bundle()`. TS facade (`src/ts/index.ts`)
  matches the npm `rolldown` shape: `bundle({input, cwd, format,
  minify, sourcemap, …}) → {warnings, output: (Chunk|Asset)[]}`.
  Smoke tested under GJS 1.88: 17 ms cold for a 3-file ESM bundle
  with constant-inlining + tree-shake, 25-byte minified single-export
  output, clear `UnresolvedEntry` diagnostics on missing inputs.
  POC scope: no JS plugins (Phase B), no watch/HMR, no incremental
  builds. Prebuilds for linux-x86_64 only. End consumers receive
  the prebuilt `.so` + `.typelib` and never see the `refs/rolldown`
  submodule.
* **lightningcss-wasm POC (2026-05-09):** Phase D-2 WASM track —
  WebAssembly bridging POC, companion to the FFI track shipped earlier
  the same day. Adds `@gjsify/lightningcss-wasm` under
  `packages/infra/lightningcss-wasm/`: vendors `lightningcss-wasm@1.32.0`'s
  NAPI-on-WASM bundle (`wasm/lightningcss_node.wasm`, 15.8 MiB) + the
  `napi-wasm@1.1.3` runtime (`src/napi-wasm.mjs`) + asyncify async
  helper (`src/async.mjs`). Pure-JS loader (`src/index.mjs`) instantiates
  the WASM via SpiderMonkey 140's synchronous
  `new WebAssembly.{Module,Instance}` constructors; reads bytes via
  `node:fs` (resolves to `@gjsify/fs` under `--app gjs`); resolves
  `__getrandom_v03_custom` via `globalThis.crypto.getRandomValues`
  (`@gjsify/webcrypto/register` under `--app gjs`). **No WASI shim
  required** — napi-wasm is a pure-JS NAPI host, no
  `wasi_snapshot_preview1` imports. Smoke tested under stock `gjs -m`:
  cold transform of a 90-byte fixture in 0.81 ms (nesting flatten +
  minify against `firefox >= 60`), source-map JSON output, parse-error
  → throw with NUL-byte-safe message. Decision matrix vs the native
  track (PR #135): native is 3-5× faster on transforms and ~960×
  faster cold init; both produce byte-identical output — WASM stays
  in tree as fallback for unsupported architectures.
* **lightningcss-native POC (2026-05-09):** Phase D-2 FFI track — first
  bridging POC for the Rust-crate runtime blockers. Adds
  `@gjsify/lightningcss-native` under `packages/infra/lightningcss-native/`:
  a Vala+Rust cdylib that exposes a single
  `GjsifyLightningcss.Engine.transform()` GObject method for the
  parse → minify(targets) → to_css pipeline. Architecture mirrors
  `@gjsify/http2-native`: Rust shim (`src/rust/`, depends on
  `lightningcss = "1"` from crates.io, ~7.7 MB cdylib) exposes one
  `extern "C"` returning a struct with malloc'd `code`/`map`/`error`
  buffers; C glue (`src/vala/gjsify-lightningcss-glue.c`) translates
  that into `GBytes` + `GError` (refcount-friendly for SpiderMonkey
  GC); Vala wraps as `Engine.transform(filename, code, browserslist,
  minify, source_map)`. TS facade exposes both the raw `Engine`
  GObject and a npm-`lightningcss`-shaped `transform({filename, code,
  targets, minify, sourceMap})` convenience helper. Smoke tested under
  GJS 1.88: nesting flatten for `firefox >= 60` query, minify
  (`.x{color:red;margin:0}`), source-map JSON output, parse-error →
  `GError` with NUL-byte safety. Prebuilds for linux-x86_64 only (CI
  multi-arch deferred).
* **Phase D-2 audit + lightningcss submodule (2026-05-09):** new
  `docs/poc/wasi-imports.md` documents the WASM/WASI host-import
  surface for both rolldown's `wasm32-wasi-threads` binding and
  lightningcss-wasm. Findings: rolldown WASM is **SAB-blocked** under
  stock GJS (Mozilla disables `SharedArrayBuffer`); lightningcss-wasm
  is clean (no WASI, no SAB, ~30 napi-wasm fns + 2 customs);
  lightningcss already ships clean C bindings via
  `refs/lightningcss/c/` which significantly de-risks the FFI POC.
  Three escape paths documented for the rolldown SAB blocker. Also
  registers `refs/lightningcss` as a submodule (v1.32.0+2).
* **integration-fast-glob (2026-05-09):** Phase D-1 Workstream Q — new
  `tests/integration/fast-glob/` suite
  (`@gjsify/integration-fast-glob`, private). 5 spec files / 98 cases
  covering the public [`fast-glob@^3`](https://github.com/mrmlnc/fast-glob)
  API used by `@gjsify/rolldown-plugin-gjsify` and
  `@gjsify/vite-plugin-gettext`. Total: **98/98 green on Node, 98/98
  green on GJS, 0 skips.** Stresses `@gjsify/fs`
  (`readdirSync(withFileTypes:true)` symlink classification, `lstat`,
  `realpath`), `@gjsify/path`, and `process.cwd()`. Fixtures generated
  at prebuild time by `scripts/setup-fixtures.mjs` rather than copied
  from the npm package — `fast-glob`'s published tarball strips its
  own `__tests__/` (the `package.json#files` filter excludes
  `out/{benchmark,tests}` and `out/**/*.spec.*`). Tree: top-level
  files (`a.ts`, `b.js`, `c.md`, `excluded.ts`, `.dotfile`), nested
  `sub/` (`c.ts`, `d.js`, `.dotsub/hidden.ts`, `deeper/e.ts`), plus
  three symlinks (file → file, dir → dir, dangling). Two root-cause
  fixes landed in the same PR (see Bug Fixes below).

### Bug Fixes

* **fs (2026-05-09):** `readdirSync(withFileTypes: true)` now reports
  symlinks correctly on GJS. `packages/node/fs/src/sync.ts` was
  opening the directory enumerator with
  `Gio.FileQueryInfoFlags.NONE`, which follows symlinks while reading
  `standard::type`. Result: every symlink dirent reported the
  *target's* type, so `Dirent.isSymbolicLink()` always returned
  `false`. `@nodelib/fs.scandir` (the engine inside `fast-glob`) uses
  that bit to short-circuit a follow-up `lstat`, so
  `followSymbolicLinks: false` had no effect on GJS — symlink entries
  were walked anyway. Fixed by switching the enumerator to
  `Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS` and threading the
  entry's `info.get_file_type()` into the `Dirent` constructor (the
  `Dirent` already mapped `Gio.FileType.SYMBOLIC_LINK` →
  `_isSymbolicLink = true`). Surfaced by the new `fast-glob`
  integration suite. All 638 fs tests still green on Node and GJS.
* **utils/callable (2026-05-09):** `makeCallable` now auto-constructs
  on no-`new` invocation. `packages/gjs/utils/src/callable.ts`'s
  `apply` trap previously always tried to transplant a fresh
  instance's properties onto `thisArg`; when the wrapped class was
  called as a plain function (`PassThrough(opts)` from `merge2`, used
  by `fast-glob`), `thisArg` was `undefined` (strict mode) and the
  transplant crashed with "undefined is not a non-null object". The
  trap now treats `thisArg == null` (or `=== globalThis`) as a
  no-`new` constructor call and returns
  `Reflect.construct(target, args, target)` — mirrors the explicit
  `if (!(this instanceof Cls)) return new Cls(...)` legacy guard
  Node's stream constructors carry. Regression tests added to
  `packages/node/stream/src/callable.spec.ts`
  (`makeCallable: no-new invocation` describe block, 4 cases —
  `PassThrough`, `Readable`, `Writable` no-new constructors plus an
  end-to-end pipe-through test). 517/517 stream tests + 266/266
  events tests + 138/138 utils tests still green on Node and GJS.

* **http2 + http2-native (2026-05-09):** Workstream A — Phase 2 of the
  http2 module. New `@gjsify/http2-native` Vala/GObject prebuild
  package wraps libnghttp2 primitives that libsoup's high-level GIR
  API does not expose: `FrameEncoder` (HPACK header-block encoder +
  raw frame builder for DATA / HEADERS / PUSH_PROMISE — backed by a
  tiny C shim around `nghttp2_hd_deflate_*` since nghttp2 has no
  upstream Vala VAPI), `StreamIdAllocator` (RFC 7540 §5.1.1 even-id
  sequencer for PUSH_PROMISE plus client-id tracking for GOAWAY),
  `SessionBridge` (HTTP/2 client-preface detection — placeholder for
  the future cleartext-h2c session driver). All buffer ownership stays
  C-side via `GLib.Bytes` so SpiderMonkey GC cannot race nghttp2
  allocations — same pattern as `@gjsify/webrtc-native` /
  `@gjsify/http-soup-bridge`. TS wrapper loads the typelib lazily
  via try/catch and falls back to JS counters when the prebuild is
  unavailable. Ships as `.so` + `.typelib` for linux-{x86_64,aarch64,
  ppc64,s390x,riscv64} via the existing CI matrix in
  `.github/workflows/prebuilds.yml` (libnghttp2-devel added to the
  Fedora + Ubuntu install steps). Wired into `@gjsify/http2`:
  `Http2ServerResponse.respondWithFile()` / `respondWithFD()` stream
  the file body through `fs.read()` 64 KiB chunks into Soup's existing
  chunked-write path with `statCheck()` callback honoured;
  `pushStream()` / `createPushResponse()` allocate even stream-ids via
  the bridge, build PUSH_PROMISE frame bytes via the encoder, and
  synthesise child `ServerHttp2Stream` instances backed by detached
  `Http2ServerResponse` buffers — application code calling
  `pushStream(headers, cb)` gets a fully-usable stream + observable
  `pushPromiseFrame` for inspection; nested-push correctly rejected
  with `ERR_HTTP2_NESTED_PUSH`. 23 new tests ported from
  `refs/node-test/parallel/test-http2-{server-push-stream,respond-file,
  respond-file-fd}.js` (151 total: 102 Node + 49 GJS). Wire-level
  PUSH_PROMISE delivery + h2c server still pending — Soup multiplexes
  HTTP/2 internally and refuses external frame injection; needs a
  parallel raw-nghttp2 server loop on a `Gio.SocketService`-accepted
  socket. Tracked in STATUS.md "Open TODOs → http2 PUSH_PROMISE wire
  delivery" and "http2 client-side `'push'` event".

* **tls (2026-05-09):** Workstream B — promoted `@gjsify/tls` from Partial
  toward Full. Added: cert-chain extraction in `getPeerCertificate(detailed)`
  (walks `Gio.TlsCertificate.get_issuer()` recursively, returns Node-shape
  `{subject, issuer, subjectaltname, valid_from, valid_to, fingerprint,
  fingerprint256, raw, issuerCertificate}`); full RFC 6125 §6.4.3 hostname
  matching in `checkServerIdentity` (wildcard prefix/suffix, xn-- A-label
  exact-match, `*.tld` rejection, IPv4/IPv6, CN fallback, error code
  `ERR_TLS_CERT_ALTNAME_INVALID`); mTLS — `tls.connect({cert,key})` calls
  `Gio.TlsConnection.set_certificate()`; `tls.createServer({requestCert,
  rejectUnauthorized,ca})` validates the client cert against `ca` via
  `cert.verify()` and sets `Gio.TlsAuthenticationMode.REQUIRED/REQUESTED/
  NONE` accordingly; SNI server — `addContext(host, ctx)` + `SNICallback`
  plumbing with RFC 6125 wildcard host-pattern matching (best-effort
  selection — Gio does not surface the ClientHello server_name extension
  to JS pre-handshake; documented in STATUS.md "Open TODOs"); ALPN —
  explicit `ALPNProtocols` via `set_advertised_protocols`,
  `tlsSocket.alpnProtocol` via `get_negotiated_protocol`; rich
  `createSecureContext({cert,key,ca,passphrase,ciphers,minVersion,
  maxVersion})` accepting string, Buffer, Uint8Array, or array thereof —
  splits CA bundles into individual PEM blocks via regex and parses each
  through `Gio.TlsCertificate.new_from_pem`, exposes a Node-compat
  `ctx.context` self-reference; custom `checkServerIdentity` override on
  `tls.connect`. Two new spec files: `cert.spec.ts` (RFC 6125
  depth/prefix/IDN edge cases + error.code) and `tls.gjs.spec.ts`
  (GJS-only Gio.TlsCertificate / TlsServerConnection option plumbing).
  All 65 `as any` removed from `packages/node/tls/src/index.spec.ts`
  (replaced by `unknown` + type guards and a `fakeCert()` helper). Test
  counts: 132 → 169 GJS (Node: 262 incl. Node-strict assertions). Gio
  gaps that genuinely cannot be filled today (SNI ClientHello selection,
  OCSP stapling, TLS session resumption, channel binding) tracked in
  STATUS.md "Open TODOs → TLS gaps that Gio does not surface".

* **worker_threads (2026-05-09):** added `transferList` support to
  `MessagePort.postMessage()` for both `ArrayBuffer` and `MessagePort`
  (Workstream C). ArrayBuffer transfer is zero-copy via SM140
  `ArrayBuffer.prototype.transfer()` — the sender's buffer becomes detached
  (`byteLength === 0`) and the receiver's TypedArray points at the moved
  storage. MessagePort transfer is an in-process channel hand-off: the source
  port detaches (further use throws DataCloneError), the receiver gets a
  fresh `MessagePort` wired to the surviving end of the channel, and any
  pending queued messages are carried over. Validation matches the HTML
  spec: detached buffers, duplicate entries, non-transferable values,
  `SharedArrayBuffer` in transfer list, self-port transfer, and
  closed-port transfer all reject with `DataCloneError` (`code: 25`) BEFORE
  any side effects (no partial transfer on error). `SharedArrayBuffer` is
  passed through by value in same-process `MessageChannel` (cross-thread
  visibility verified via `Atomics.{store,load,notify}` on Node where SAB
  is exposed). Implementation extends
  `packages/gjs/utils/src/structured-clone.ts` with a transfer context plus
  a view-snapshot pre-walk — TypedArray and DataView `byteOffset`/`length`
  are captured BEFORE buffer transfer because `ArrayBuffer.transfer()`
  detaches all source views, so reading their metadata after transfer
  yields 0. The MessagePort layer in
  `packages/node/worker_threads/src/message-port.ts` substitutes port
  placeholders into the value tree pre-clone, then walks the cloned tree
  to materialise receiver-side ports — the structured-clone layer stays
  port-agnostic. New unit tests: 32 across `transferList — ArrayBuffer`
  (6), `transferList — MessagePort` (4), `SharedArrayBuffer` (3 — Node;
  1 skip-marker on GJS) suites; full counts now 270 Node / 264 GJS.
  `as any` removed from `packages/node/worker_threads/src/index.spec.ts`
  (30 → 0) — added `BroadcastChannelW3C` and `MessagePortW3C` helper
  aliases for the W3C surface that `@types/node` types more tightly than
  the runtime. New integration suite
  `tests/integration/worker-stress/` (`@gjsify/integration-worker-stress`)
  with two specs: `transferlist-stress.spec.ts` exercises the bulk
  transfer path (256 chunks × 64 KiB = 16 MiB through one channel,
  4-channel fan-out for per-channel FIFO ordering, 5-hop port-transfer
  chain that round-trips a payload through the surviving inner channel)
  and `sab-parallel-hash.spec.ts` runs 4 native worker threads over a
  1 MiB `SharedArrayBuffer` computing SHA-256 over disjoint slices with
  an `Atomics`-backed completion barrier, partial digests folded against
  a main-thread reference (Node-only — gracefully skips on GJS).
  Throughput baselines logged per run as a fixture for future
  GC/scheduler regressions: Node ≈ 727 MiB/s transferList,
  ≈ 28 MiB/s SAB hash; GJS ≈ 235 MiB/s transferList. Cross-process SAB
  via subprocess `Worker` IPC remains a deferred follow-up — needs a
  `@gjsify/sab-native` Vala mmap bridge — tracked under STATUS.md
  "Open TODOs → SharedArrayBuffer cross-process sharing".

### Refactoring

* **http (2026-05-09):** type-safety pass on
  `packages/node/http/src/index.spec.ts` (Workstream K). `as any`
  reduced from 50 → 0 (one comment-only mention of the term remains in
  the file header explaining the strategy). Same hybrid pattern as
  Workstream G (`@gjsify/http2`): the spec is cross-platform and runs
  in both the Node and GJS test bundles, so the runtime source stays
  `import http from 'node:http'` — a direct
  `import { … } from '@gjsify/http'` would drag `gi://Soup/Gio/GLib`
  into the Node bundle and crash it at load. Impl-private symbols
  (`OutgoingMessage`, `IncomingMessage`, `Agent`, `validateHeaderName`,
  `validateHeaderValue`, `setMaxIdleHTTPParsers`) come in via
  `import type { … } from '@gjsify/http'` (stripped at compile time)
  and are exposed through a single `gjsHttp = http as unknown as
  Omit<typeof http, …> & { … }` boundary cast at the top of the file.
  Replacements: `(http as any).OutgoingMessage`/`setMaxIdleHTTPParsers`/
  `validateHeaderName`/`validateHeaderValue` → `gjsHttp.<name>`;
  `new (http.IncomingMessage as any)(null)` (15×) →
  `new gjsHttp.IncomingMessage(null)` (constructor typed as
  `(socket?: unknown) => IncomingMessage` to model the GJS impl's
  zero-arg constructor); `(agent as any).protocol`/`maxFreeSockets`/
  `keepAliveMsecs`/`keepAlive` → bare property access on
  `new gjsHttp.Agent()`; `(http.globalAgent as any).protocol` →
  `gjsHttp.globalAgent.protocol`; `(res as any).appendHeader`/
  `writeContinue`/`flushHeaders` → bare method calls (these are
  already in `@types/node`'s `ServerResponse`, so the casts were dead
  weight). One `100 as any` (negative-test for `validateHeaderName`)
  tightened to `100 as unknown as string`. Two `catch (error: any)`
  blocks reduced to bare `catch (error)`. No new exports from
  `@gjsify/http` were needed — every symbol was already exported. All
  1040 Node tests + 1038 GJS tests green (unchanged baseline). Pure
  type-safety; no runtime change. Hygiene check: `dist/test.node.mjs`
  contains zero `gi://` imports.

* **webcrypto (2026-05-09):** type-safety pass on
  `packages/web/webcrypto/src/index.spec.ts` (Workstream M). `as any`
  reduced from 26 → 0. Pattern-(a) algorithm narrowings — `(key.algorithm
  as any).length` / `.hash.name` / `.namedCurve` (19 occurrences) — now
  use the impl-side `AesKeyAlgorithm` / `HmacKeyAlgorithm` /
  `EcKeyAlgorithm` interfaces, type-only-imported from `@gjsify/webcrypto`
  (Rule 2b — the spec is cross-platform and runs in the Node bundle, so a
  runtime `import { … } from '@gjsify/webcrypto'` would drag GJS-only
  `@girs/*` code in via `subtle.ts`'s `import('crypto')` path; type-only
  imports are erased at compile time). Three `getRandomValues(<invalid>
  as any)` casts on `Float32Array` / `Float64Array` / `DataView` retyped
  to `as unknown as ArrayBufferView<ArrayBuffer>` (preserves the
  intentional invalid-input test). Two `KeyUsage[]` casts (`['encrypt']
  as any` for HMAC, `['sign'] as any` for AES) tightened to `as unknown
  as KeyUsage[]`. The five remaining `as any`s on first arguments to
  `generateKey({ name: 'CHACHA20' } as any, …)` / `{ name: 'AES-CBC',
  length: 100 } as any` / `'pkcs8' as any` were dead weight — the public
  signatures (`AlgorithmIdentifier = string | { name: string; [key:
  string]: unknown }`, `format: 'raw' | 'jwk' | 'pkcs8' | 'spki'`)
  already accept these shapes, so the casts were stripped entirely. New
  type-only re-exports from `packages/web/webcrypto/src/index.ts`:
  `AesKeyAlgorithm`, `HmacKeyAlgorithm`, `EcKeyAlgorithm`,
  `RsaHashedKeyAlgorithm`, plus the full set of algorithm-parameter
  interfaces (`AesKeyGenParams`, `HmacKeyGenParams`, `EcKeyGenParams`,
  `HmacImportParams`, `EcKeyImportParams`, `AesCbcParams`, `AesCtrParams`,
  `AesGcmParams`, `RsaOaepParams`, `EcdsaParams`, `RsaPssParams`,
  `Pbkdf2Params`, `HkdfParams`, `EcdhKeyDeriveParams`,
  `AlgorithmIdentifier`) — these were already declared in `crypto-key.ts`
  but only `KeyAlgorithm` / `KeyUsage` / `KeyType` / `CryptoKeyPair` were
  re-exported from the package root. All 486 tests green on Node, all
  GJS tests green (unchanged baseline). Pure type-safety; no runtime
  change.

* **readline (2026-05-09):** type-safety pass on
  `packages/node/readline/src/index.ts` (Workstream L). `as any`
  reduced from 26 → 0 in production source. New internal-only
  helper module `src/internal/stream-types.ts` (per AGENTS.md
  Rule 2c — not exported from `package.json#exports`) declares
  `GjsReadableTty` and `GjsWritableTty` interfaces that augment
  `node:stream`'s `Readable`/`Writable` with the TTY-specific
  runtime members (`isRaw`, `isTTY`, `setRawMode`, `columns`,
  `rows`, `getColorDepth`, `hasColors`) that exist on both
  `tty.ReadStream`/`WriteStream` and `@gjsify/process`'s
  `ProcessReadStream`/`ProcessWriteStream` but are absent from the
  base `Readable`/`Writable` types. A third helper
  `KeypressTaggedStream` (intersection type — `Readable &
  { [key: symbol]: ... }`, modelled as intersection rather than
  `extends Readable` to avoid colliding with `Readable`'s built-in
  symbol keys like `Symbol.asyncDispose` /
  `EventEmitter.captureRejectionSymbol`) replaces the
  `(stream as any)[_KEYPRESS_DECODER]` casts in
  `emitKeypressEvents`. Public API of `Interface` unchanged
  (`_input: Readable | null`, `_output: Writable | null`); only
  internal usage narrows. The `emitKeypressEvents(stream, iface)`
  signature was tightened from `Readable & Record<symbol, unknown>`
  to plain `Readable` (Node-spec compatible) with the symbol-tagged
  view applied internally. Side-effects: `Interface` now exposes
  the `escapeCodeTimeout?: number` field already declared on
  `InterfaceOptions` so `emitKeypressEvents(stream, this)`
  satisfies the structural `{ escapeCodeTimeout?: number }`
  parameter without `as any` (also a behavior parity improvement —
  Node readline forwards `opts.escapeCodeTimeout`). All 145 tests
  green on both Node and GJS (unchanged baseline).

* **webrtc (2026-05-09):** type-safety pass on
  `packages/web/webrtc/src/{rtc-peer-connection,rtc-rtp-sender,rtc-rtp-transceiver}.ts`
  (Workstream N). `as any` reduced from 40 → 0 across the three
  production files (peer-connection 20→0, rtp-sender 16→0,
  rtp-transceiver 4→0). New internal-only helper module
  `src/internal/gst-types.ts` (per AGENTS.md Rule 2c — not exported
  from `package.json#exports`) declares thin element-specific
  interfaces extending the broad `Gst.Element` / `Gst.Pad` typings:
  `WebRtcBin` exposes the 14 GObject properties the
  `RTCPeerConnection` impl reads or writes on the `webrtcbin`
  element (`stun_server`, `turn_server`, `ice_transport_policy`,
  `bundle_policy`, the four `*_state` enums, and the six SDP
  `*_description` slots); `WebRtcSrcPad` exposes the `transceiver`
  back-pointer that webrtcbin attaches to its SRC pads;
  `ValveElement`, `RtpPayloaderElement`, `CapsFilterElement`, and
  `Vp8EncElement` cover the encoder-chain elements
  (`@gjsify/webrtc`'s `_wirePipeline` builds explicit
  `valve → convert → encode → payloader → capsfilter` chains for
  audio/video). Each interface ships a paired `asXxx(el)` narrowing
  helper used at the single creation site. `RTCPeerConnection`
  also tightens `_findNewGstTransceiver(): any` →
  `GstWebRTCRTPTransceiver | null`, `_createTransceiverWrapper(any)`
  → `(GstWebRTCRTPTransceiver)`, and adds a literal-union prop type
  to `_descProp(prop)` so the six SDP-getter call sites are checked
  against the `WebRtcBin` interface. Three remaining `as unknown as
  …` cross-castings stay because they are not the GStreamer-property
  pattern but webrtcbin's GObject *action* signals (`emit('create-data-channel')`,
  `emit('add-transceiver')`, `emit('get-transceiver')`) — the GIR
  generator types `emit()` overloads as `void`-returning, so the
  signal's actual return value flows back through `as unknown` (a
  comment documents this at each site). Dropped two `iceState as
  any` / `gatheringState as any` casts on `RTCIceTransport._setState`
  / `_setGatheringState` — the source and target string unions are
  identical (`'new' | 'checking' | 'connected' | …`), so the casts
  were dead weight. `WebrtcbinBridge as any` constructor cast also
  removed — `@gjsify/webrtc-native`'s typings already declare the
  `Partial<{ bin: Gst.Element }>` constructor-properties shape. In
  `RTCRtpSender`, the five `private _pipeline: any` / `_webrtcbin:
  any` / `_elements: any[]` / `_valve: any` / `_teeSrcPad: any`
  fields plus the constructor's `pipeline?: any, webrtcbin?: any`
  parameters are now typed as `GstNs.Pipeline | null` /
  `GstNs.Element | null` / `GstNs.Element[]` / `ValveElement | null`
  / `GstNs.Pad | null` (with `GstNs` aliasing `gi://Gst?version=1.0`
  to avoid colliding with the runtime `Gst` import from `gst-init.js`).
  Two local `trackAny` views inside `_wirePipeline` and `replaceTrack`
  are narrowed to the four `_gstSource` / `_gstPipeline` / `_gstTee`
  / `_teeMultiplexer` GStreamer-attached fields on `MediaStreamTrack`
  (these remain `any` on the class itself — that is a separate
  refactoring target outside this stream's scope: `media-stream-track.ts`
  declares them `any` because they are runtime-attached by the
  get-user-media / VideoBridge code paths). One ergonomic upstream
  fix: `gstDirectionToW3C(d): number` → `: GstWebRTC.WebRTCRTPTransceiverDirection`
  in `gst-enum-maps.ts` so the writeback `gstTrans.direction =
  w3cDirectionToGst(d)` typechecks against the GIR enum-typed
  property without a cast. Pure type-safety; runtime behavior
  unchanged. `yarn check` + `yarn build` + `yarn test:gjs` all
  green on Fedora 43 (GJS 1.86 / SpiderMonkey 140).

* **zlib (2026-05-09):** type-safety pass on
  `packages/node/zlib/src/index.spec.ts` (Workstream J). `as any`
  reduced from 20 → 0. All 20 occurrences were `gzipSync(str as
  any)` / `deflateSync(str as any)` / `deflateRawSync(str as any)`
  workarounds for an outdated reading of `@types/node` — the current
  `InputType = string | ArrayBuffer | NodeJS.ArrayBufferView` already
  accepts `string`, so the casts were dead weight obscuring the
  actually-typed call. Same survey also stripped 55 redundant `as
  unknown as Buffer` launderings on `Promise<Buffer>` resolves —
  `CompressCallback`'s `result: NonSharedBuffer` is already
  assignable to `Buffer` via Node's class hierarchy. Hybrid type-only
  `@gjsify/zlib` import was evaluated and rejected: this spec is
  cross-platform (loads on both Node and GJS test bundles via
  `index.spec.ts`), and the `as any` casts were not impl-private
  narrowing — purely incorrect casts. Net diff: 75 unsafe casts
  removed, zero added; spec reads as straight-line typed code. All
  53324 tests green on both Node and GJS (unchanged baseline). Node
  bundle hygiene confirmed: no new `gi://` references introduced
  (the single pre-existing `@girs/gjs` import comes from
  `@gjsify/unit`'s GJS code path and is unaffected).

* **webgl (2026-05-09):** type-safety pass on
  `packages/framework/webgl/src/ts/webgl2.spec.ts` (Workstream I).
  `as any` reduced from 2 → 0 in `webgl2.spec.ts`. Replaced
  `(c as any).getContext('webgl2')` with `c as unknown as
  OurHTMLCanvasElement` — the bridge callback types `c` as
  `globalThis.HTMLCanvasElement` (DOM spec), but at runtime it is the
  GTK-backed `@gjsify/webgl` `HTMLCanvasElement` whose `getContext()`
  overload returns the concrete `WebGL2RenderingContext`. Replaced
  `getExtension('OES_texture_half_float') as any` with `as unknown as
  OESTextureHalfFloat | null` — the extension class is now exposed via
  the package barrel, so the test reaches `HALF_FLOAT_OES` through a
  typed property instead of an untyped indexer. New named exports on
  `@gjsify/webgl`: `OESTextureHalfFloat`, `OESTextureFloat`,
  `OESTextureFloatLinear`, `OESStandardDerivatives`,
  `OESElementIndexUint`, `EXTBlendMinMax`, `EXTColorBufferFloat`,
  `EXTColorBufferHalfFloat`, `EXTTextureFilterAnisotropic`,
  `STACKGLDestroyContext`, `STACKGLResizeDrawingBuffer` — the
  extension classes were already on disk under
  `src/ts/extensions/` but never re-exported from the index, leaving
  consumers no choice but `as any` on `getExtension()` results. Pure
  type-safety refactor — no runtime change. 860/860 GJS tests green
  (unchanged baseline). Per CLAUDE.md Testing → Rules 2 + 2b: this
  spec is GJS-only (relies on Gtk.GLArea + libgwebgl), so direct
  `@gjsify/webgl` imports are sanctioned and impl-private types
  (extension classes) are the right vocabulary instead of casts.

* **canvas2d-core (2026-05-09):** type-safety pass on
  `packages/dom/canvas2d-core/src/canvas-rendering-context-2d.ts` (Workstream H).
  `as any` reduced from 34 → 0 in `canvas-rendering-context-2d.ts`, and from 35
  → 0 across all non-test source under `packages/dom/canvas2d-core/src/` (one
  occurrence remains inside a doc comment). New `src/cairo-types.ts` introduces
  `CairoPattern = Cairo.Pattern & CairoPatternRuntime` plus an `asCairoPattern()`
  narrowing helper for the `setExtend`/`setFilter`/`getExtend`/`getFilter`
  methods that exist at runtime on every `cairo_pattern_t` but are absent from
  the GIR-generated `@girs/cairo-1.0` / `@girs/gjs/cairo` typings (the GIR
  emitter ships an empty `class Pattern {}` for "Foreign Struct" types, and
  module-augmenting `giCairo.Pattern` is not effective because `@girs/gjs/cairo`
  uses an unexported `declare namespace giCairo`). New `src/dom-types.ts`
  introduces `CanvasLike`, `PixbufImageSource`, `CanvasImageSource`,
  `CanvasContext2DLike`, `DOMMatrix2DLike`, `DOMMatrixConstructor`, and
  `CanvasGlobalThis` interfaces — plus `isPixbufImageSource()` and
  `isCanvasImageSource()` type guards — so the constructor (`canvas: any →
  CanvasLike`), `drawImage()`/`createPattern()` (`image: any → unknown` +
  guarded narrowing), `getTransform()` fallback (`globalThis as any` →
  `globalThis as CanvasGlobalThis`, struct literal typed
  `DOMMatrix2DLike`), and `_getDrawImageSource()` (`image: any → unknown`) all
  work against concrete types. `_options?: any` on the constructor becomes a
  fully-typed `CanvasRenderingContext2DInit` mirroring the WHATWG dictionary.
  Direct `Cairo.Context` method calls (`userToDevice`, `setAntialias`,
  `paintWithAlpha`, `getSource`) and `Gdk.cairo_set_source_pixbuf(this._ctx,
  …)` / `PangoCairo.{create_layout,show_layout,layout_path}(this._ctx, …)` no
  longer need `as any` — the GIR types already accept `Cairo.Context` directly,
  the casts were vestigial. `canvas-pattern.ts` adopts the same shape: the
  private constructor stores a `CairoPattern` (rather than `Cairo.SurfacePattern`
  + `(pat as any).setExtend`), and `CanvasPattern.create(image: any → unknown)`
  uses the new type guards. Return-type casts to the WHATWG DOM lib types
  (`new OurCanvasGradient(…) as any → as unknown as CanvasGradient`, same for
  `CanvasPattern` and `ImageData`) tighten the cast chain through `unknown`.
  Test counts unchanged — all 578 GJS tests pass; `@gjsify/dom-elements`,
  `@gjsify/canvas2d`, and the `@gjsify/example-dom-canvas2d-fireworks`
  showcase rebuild clean. No runtime change.

* **http2 (2026-05-09):** type-safety pass on
  `packages/node/http2/src/http2.gjs.spec.ts` (Workstream G). `as any` reduced
  from 49 → 0 in code (one occurrence remains in a doc comment). Strategy:
  keep `import http2 from 'node:http2'` as the runtime source — the file is
  built into the Node test bundle alongside the cross-platform `index.spec.ts`,
  and a direct `import { … } from '@gjsify/http2'` would drag
  `gi://Soup/Gio/GLib` into that bundle and crash it at load — and pull the
  impl-private classes (`Http2Server`, `Http2ServerRequest`,
  `Http2ServerResponse`, `ClientHttp2Session`, `ClientHttp2Stream`,
  `ServerHttp2Stream`) via a single `import type { … } from '@gjsify/http2'`.
  Type-only imports are stripped at compile time, so the Node bundle stays
  free of GJS-only code, but TypeScript sees the real shapes (concrete
  subclasses of `EventEmitter`/`Readable`/`Writable`/`Duplex`) instead of
  `@types/node`'s narrower declarations. A single
  `gjsHttp2 = http2 as unknown as { … }` cast at the top of the file is the
  boundary between the two views; every test in the file then uses the
  retyped object directly without further casts. Helpers (`withServer`,
  `collectBody`) and event handlers (`(req, res) => …`,
  `('stream', (stream, headers) => …)`) all gain proper typing. All 128 tests
  (102 Node-shared + 26 GJS-only) pass on both targets. No runtime change.
* **webgl (2026-05-09):** split the 4164-line
  `packages/framework/webgl/src/ts/webgl-context-base.ts` — the largest file in
  the repo — into focused composition modules under
  `packages/framework/webgl/src/ts/context/` (Workstream D). New layout —
  `state.ts` (enable/disable/blend/stencil/clear + error stack),
  `buffer-binding.ts` (bindBuffer/bufferData/bufferSubData),
  `texture-management.ts` (bindTexture, texImage2D/texSubImage2D, pixelStorei +
  texture-unit tracker), `framebuffer.ts`
  (bindFramebuffer/framebufferTexture2D/renderbufferStorage + completeness
  pre-check), `shader-program.ts` (compileShader/linkProgram/useProgram + every
  uniform setter), `drawing.ts` (drawArrays/drawElements, viewport/scissor,
  vertex attribs). Each module declares a typed `*Methods` interface
  (declaration-merged into `WebGLContextBase`) plus an
  `install*Methods(proto)` registration function — the base file calls
  `installAllContextMethods(WebGLContextBase.prototype)` after the class is
  fully declared, which sidesteps the circular-import trap that prototype-merge
  mixins would otherwise hit when split modules import `WebGLContextBase` for
  runtime use. The base file is now ≈590 lines, owning fields, abstract `_gl`,
  the constructor, `_init`, `getParameter` (whose 200-line switch is the only
  large method that stays), `getExtension`, `getSupportedExtensions`, and the
  foundational `_check{Owns,Valid,Wrapper}` helpers reused by every split
  module. Public surface unchanged — `WebGLRenderingContext` and
  `WebGL2RenderingContext` (and every external consumer, including the
  Three.js post-processing showcase) work without modification. `as any`
  reduced from 74 to 44 occurrences across `packages/framework/webgl/src/`:
  `webgl-context-base.ts` went 2 → 0, `webgl2-rendering-context.ts` went 29 → 1
  (a doc comment that mentions the term). Remaining 44 are intentional —
  conformance spec files use `(gl as any).method(badArg)` to drive negative
  tests, `webgl-bridge.ts` writes globalThis for runtime bootstrap, and a
  handful of `_native` / `_ctx` accesses in `webgl1.spec.ts` reach into impl
  internals not exposed on the DOM `WebGLRenderingContext` interface.
  Replaced six bare `// TODO`/`// FIXME` comments in the original file with
  structured `STATUS.md "Open TODOs": …` comments next to the affected code
  paths and corresponding entries under the new "Low priority — WebGL deferred
  items (Workstream D)" section in STATUS.md (drawingBufferColorSpace
  colorimetry plumbing, multi-FBO texture/renderbuffer detach,
  MAX_RENDERBUFFER_SIZE JS-side caching, optional headless drawing-buffer
  pre-allocation). All 860 GJS WebGL tests pass; the Three.js post-processing
  showcase rebuilds clean.

* **stream:** split the 1676-line `packages/node/stream/src/index.ts` into
  per-class modules (Workstream E). New layout — `stream-base.ts` (`Stream_`),
  `readable.ts`, `writable.ts`, `duplex.ts`, `transform.ts`, `passthrough.ts`,
  `utils/{pipe,pipeline,finished}.ts`, `internal/{state,types}.ts`. `src/index.ts`
  is now a thin re-export barrel that preserves the historical default-export
  shape (`Stream` augmented with `{Readable, Writable, Duplex, Transform,
  PassThrough, pipeline, finished, addAbortSignal, isReadable, isWritable,
  isDestroyed, isDisturbed, isErrored, getDefaultHighWaterMark,
  setDefaultHighWaterMark}`) so `cjs-compat.cjs`'s `mod.default || mod` and
  `util.inherits(Sub, require('stream'))` keep working unchanged.
  `Stream_.prototype.pipe` is wired via a late-binding `_setPipeImpl` hook
  rather than a direct top-level import — necessary because the natural
  dependency graph (stream-base → pipe → readable → stream-base) trips GJS's
  eager ESM evaluation with "class heritage Stream\_ is not an object or null".
  All 509 GJS / 507 Node stream tests pass; integration suites (streamx 156/156,
  socket.io and webtorrent unchanged from pre-refactor baseline) are unaffected.
  `as any` in the source files reduced from 35 to ~0 — replaced by typed
  `unknown` casts, concrete stream subtypes, or narrow `as unknown as` bridges
  where Node's option-type `this: Readable` doesn't unify with our internal
  `Readable_`.

### Tests

* **integration-yargs (2026-05-09):** Phase D-1 Workstream O — new
  `tests/integration/yargs/` suite (`@gjsify/integration-yargs`,
  private). 5 spec files / 37 cases ported from yargs v18 upstream
  (`test/yargs.cjs`, `test/command.cjs`, `test/usage.cjs`) into
  `@gjsify/unit` style, plus an original ESM-entry-points spec covering
  the exact import shape `@gjsify/cli` relies on (`yargs`,
  `yargs/yargs`, `yargs/helpers#hideBin`). Total: **52/52 green on
  Node, 52/52 green on GJS, 0 skips.** Stresses `@gjsify/events`
  (Yargs internals + `EventEmitter`-style hooks), `@gjsify/util`
  (yargs error formatting), `process.argv` (`hideBin()`), and the ESM
  loader path through yargs's `lib/platform-shims/esm.mjs`. Yargs's
  full transitive dep tree (cliui, escalade, get-caller-file,
  string-width, y18n, yargs-parser) bundles + runs on GJS without any
  `@gjsify/*` patches — this clears one of the 11 npm runtime-deps
  the future GJS-hosted `@gjsify/cli` build needs (tracked in
  STATUS.md "Integration Test Coverage → yargs").

* **integration-acorn (2026-05-09):** Phase D-1 Workstream P — new
  `tests/integration/acorn/` suite (`@gjsify/integration-acorn`,
  private). 5 spec files / 38 cases covering `acorn@^8.16` (parser)
  and `acorn-walk@^8.3` (AST visitor) — both pure-JS deps of
  `@gjsify/rolldown-plugin-gjsify`'s `auto-globals` detector. Total:
  **127/127 green on Node, 127/127 green on GJS, 0 skips.** Stresses
  the SpiderMonkey 140 ES2024 surface end-to-end through the parser:
  arrow + destructuring + rest, classes (static / private / getters),
  async/await + for-await-of, optional chaining, nullish coalescing,
  logical assignment, tagged templates, named/default imports,
  dynamic `import()`, import attributes (`with { type: 'json' }` at
  `ecmaVersion: 'latest'`), top-level await, multi-line `loc`
  reporting (1-based line / 0-based column), `(line:col)` error
  suffix shape, `simple` / `ancestor` / `full` / `recursive` walkers,
  `findNodeAt` / `findNodeAround` range queries, `make()` walker
  composition. No `@gjsify/*` fixes were required — first-try green
  on both runtimes. Acts as a clean canary that the SpiderMonkey 140
  / `firefox140` lowering / `@gjsify/*` core JS path runs the parser
  used by every `--globals auto` build. Clears two more of the 11
  Phase D-1 npm runtime-deps the future GJS-hosted `@gjsify/cli`
  build needs (tracked in STATUS.md "Integration Test Coverage →
  acorn + acorn-walk").

* **integration-pkg-types (2026-05-09):** Phase D-1 Workstream U —
  combined `tests/integration/pkg-types/` suite
  (`@gjsify/integration-pkg-types`, private). 5 spec files / 38 cases
  covering [`pkg-types@^2`](https://github.com/unjs/pkg-types) (read +
  write of `package.json` / `tsconfig.json`, `findFile` / `findNearestFile`
  walking up the tree, `definePackageJSON` / `defineTSConfig` identity
  helpers) and [`get-tsconfig@^4`](https://github.com/privatenumber/get-tsconfig)
  (`getTsconfig`, `parseTsconfig`, `findTsconfig`, `extends` chain
  resolution including 2-level `a → b → c` chains, `createPathsMatcher`
  for path aliases + baseUrl-based fallback). Total: **88/88 green on
  Node, 88/88 green on GJS, 0 skips.** Stresses `@gjsify/fs` (read +
  write JSON files, `findNearestFile` walking up directory trees),
  `@gjsify/path` (`resolve`, `dirname`, `join`, `relative`), and the
  built-in JSON parser. Both packages are direct devDeps of
  `@gjsify/cli` (config loading) — no `@gjsify/*` fixes required, the
  suite passed first try after correcting three test assertions to
  match documented library semantics (relative paths normalized to
  `'./<value>'`; non-aliased specifiers fall back to baseUrl-relative
  resolution rather than `[]`). Clears two more of the 11 Phase D-1
  npm runtime-deps the future GJS-hosted `@gjsify/cli` build needs
  (tracked in STATUS.md "Integration Test Coverage → pkg-types +
  get-tsconfig").

* **integration-rollup-pluginutils (2026-05-09):** Phase D-1 Workstream V
  — new `tests/integration/rollup-pluginutils/` suite
  (`@gjsify/integration-rollup-pluginutils`, private). 5 spec files /
  54 cases covering [`@rollup/pluginutils@^5`](https://github.com/rollup/plugins/tree/master/packages/pluginutils)
  — the helper toolkit consumed by `@gjsify/rolldown-plugin-gjsify`
  itself: `createFilter` (include/exclude with globs, RegExp,
  mixed arrays, `cwd` resolution), `dataToEsm` (named exports +
  default wrapper, `preferConst`, `compact`, `objectShorthand`,
  Date/RegExp/BigInt/NaN/Infinity/-0/U+2028/U+2029 serialization),
  `makeLegalIdentifier` (kebab→camel, illegal-char `_`-replace,
  reserved/global prefix), `attachScopes` (function/class/catch/
  block/for-init scope handling, ancestor lookups), and
  `extractAssignedNames` (Identifier, ObjectPattern incl. renames +
  rest, ArrayPattern incl. holes + RestElement, AssignmentPattern
  defaults, MemberExpression `[]` fallback). Total: **138/138 green
  on Node, 138/138 green on GJS, 0 skips.** No `@gjsify/*` fixes
  required — pure JS over `node:path` + the picomatch glob library;
  picomatch's heavy RegExp surface also runs unmodified on
  SpiderMonkey 140. Clears another of the 11 Phase D-1 npm runtime-
  deps the future GJS-hosted `@gjsify/cli` build needs (tracked in
  STATUS.md "Integration Test Coverage → @rollup/pluginutils").

* **integration-minify-xml (2026-05-09):** Phase D-1 Workstream X —
  new `tests/integration/minify-xml/` suite
  (`@gjsify/integration-minify-xml`, private). 3 spec files / 32
  cases covering [`minify-xml@^4`](https://github.com/kristian/minify-xml)
  — the pure-JS XML compressor consumed by
  `@gjsify/vite-plugin-blueprint` to compress the XML output emitted
  by `blueprint-compiler` for `.blp` Blueprint sources. Suites:
  `basic` (comment removal, inter-tag whitespace removal, in-tag
  whitespace collapse, empty-element collapse, CDATA + prolog
  preservation), `options` (`removeComments`, `collapseEmptyElements`,
  `removeWhitespaceBetweenTags`, `collapseWhitespaceInTags`,
  `xml:space="preserve"`, `trimWhitespaceFromTexts`,
  `collapseWhitespaceInTexts`, `ignoreCData`, `removeUnusedNamespaces`),
  `edge-cases` (100-deep nesting, single-quoted attrs, `>` inside
  attr values, XML entities, processing instructions, mixed content,
  Blueprint-style GTK XML resource, idempotency, unicode CJK + emoji
  + Cyrillic, CDATA containing XML-like markup, empty/self-closing-
  only). Total: **63/63 green on Node, 63/63 green on GJS, 0 skips.**
  No `@gjsify/*` fixes required — `minify-xml` is built entirely on
  `String.prototype.replace` + heavy lookbehind/lookahead `RegExp`s,
  and SpiderMonkey 140's RegExp engine matches V8 behavior exactly
  for every pattern the minifier exercises (including the lookbehind-
  anchored `tagPattern` chain that's the heart of the algorithm).
  Clears the last of the 11 Phase D-1 npm runtime-deps the future
  GJS-hosted `@gjsify/cli` build needs (excluding the Rust blockers
  `rolldown` / `lightningcss` that fall through to D-2 research).
  Tracked in STATUS.md "Integration Test Coverage → minify-xml".

* **integration-deepkit-type-compiler (2026-05-09):** Phase D-1
  Workstream W — new `tests/integration/deepkit-type-compiler/` suite
  (`@gjsify/integration-deepkit-type-compiler`, private). 2 spec files
  / 13 cases covering [`@deepkit/type-compiler@^1`](https://github.com/deepkit/deepkit-framework)
  — the TypeScript reflection emitter consumed by
  `@gjsify/rolldown-plugin-deepkit` (opt-in via `reflection: true`).
  Suites: `loader` (`DeepkitLoader` constructor + `transform()`
  round-trip on plain code, empty input, class+interface declarations,
  two-transforms-don't-interfere, no-typeOf-call no-instrumentation
  invariant), `transform` (`typeOf<T>()` instrumentation signal —
  call rewritten to `typeOf<T>([], …)` — per-kind metadata emission
  shapes: named interface (hoisted `const __ΩName`), class (`static
  __type` member), primitive type alias (hoisted `__ΩName`), inline
  structural type (in-place encoded string), round-trip safety,
  syntactically broken input handling). Total: **29/29 green on Node,
  29/29 green on GJS, 0 skips.** No `@gjsify/*` fixes required —
  Deepkit + its `typescript@^5` peer + `@marcj/ts-clone-node`
  transitive bundle and run cleanly on SpiderMonkey 140 through the
  standard `@gjsify/cli` build path. The test bundle alone is ≈8 MiB
  (TypeScript itself dominates), confirming Rolldown's tree-shaking
  + the `--app gjs` config don't choke on the deepest dep we ship.
  Clears the next-to-last of the 11 Phase D-1 npm runtime-deps the
  future GJS-hosted `@gjsify/cli` build needs (excluding the Rust
  blockers `rolldown` / `lightningcss`). Tracked in STATUS.md
  "Integration Test Coverage → @deepkit/type-compiler".

## [0.3.21](https://github.com/gjsify/gjsify/compare/v0.3.20...v0.3.21) (2026-05-08)

### Bug Fixes

* **rolldown,canvas2d-core:** require kind + non-finite drawImage args ([#99](https://github.com/gjsify/gjsify/issues/99)) ([cc79e2e](https://github.com/gjsify/gjsify/commit/cc79e2e72aa50f3a25b6a16f04699503963664b3)), closes [#94](https://github.com/gjsify/gjsify/issues/94)

## [0.3.20](https://github.com/gjsify/gjsify/compare/v0.3.19...v0.3.20) (2026-05-08)

## [0.3.19](https://github.com/gjsify/gjsify/compare/v0.3.18...v0.3.19) (2026-05-08)

### Bug Fixes

* **cli:** pin gjsify showcase dlx spec to CLI version ([#97](https://github.com/gjsify/gjsify/issues/97)) ([1b7697d](https://github.com/gjsify/gjsify/commit/1b7697d8f44682d67470cd08f22620f00085ba25)), closes [#94](https://github.com/gjsify/gjsify/issues/94)

## [0.3.18](https://github.com/gjsify/gjsify/compare/v0.3.17...v0.3.18) (2026-05-08)

### Bug Fixes

* **cli:** drop @gjsify/webgl pre-flight from gjsify showcase ([#96](https://github.com/gjsify/gjsify/issues/96)) ([d501bf7](https://github.com/gjsify/gjsify/commit/d501bf7532cabeaf6cd93e317bc8a24976bdd6d1))

## [0.3.17](https://github.com/gjsify/gjsify/compare/v0.3.16...v0.3.17) (2026-05-08)

### Features

* gjsify dlx native-prebuild fix + minify-default + showcase shape ([#94](https://github.com/gjsify/gjsify/issues/94)) ([6c167c2](https://github.com/gjsify/gjsify/commit/6c167c2064bd1a95f2072357648a24ab74b5611a))

### Bug Fixes

* **cli:** gjsify build honours bundler.input from package.json[#gjsify](https://github.com/gjsify/gjsify/issues/gjsify) ([3a8cd93](https://github.com/gjsify/gjsify/commit/3a8cd9348b441496c456d9e0b8239dda9aca18c9))

## Unreleased — dlx native-prebuild fix + minify-default + showcase shape (2026-05-08)

### ⚠ BREAKING CHANGES

* **cli:** `gjsify build` minifies by default (`--minify`'s default flipped from `false` to `true`). Opt-out: pass `--no-minify` on the CLI or set `bundler.output.minify: false` in `package.json#gjsify`. The four app/library orchestrators (`app/{gjs,browser,node}.ts`, `library/lib.ts`) no longer hard-code `minify: false` after the user-output spread, so `bundler.output.minify` from user config now actually takes effect (it was silently overridden before).

### Bug Fixes

* **cli:** `gjsify dlx` / `gjsify run` now also walks the bundle's own `node_modules` tree to detect native gjsify prebuilds (`@gjsify/<vala-bridge>/prebuilds/linux-<arch>/`). Previously the fallback detector (`resolveNativePackages`) only iterated the bundle's package.json#dependencies — direct deps only — so transitive Vala typelibs (e.g. `@gjsify/http-soup-bridge` pulled in by `@gjsify/http`) were missed and `gjsify showcase express-webserver` crashed with `Typelib file for namespace 'GjsifyHttpSoupBridge' not found`. The two overlapping detectors collapse into a single algorithm: `detectNativePackages(startDir)` walks up from a startpoint and exhaustively scans every `node_modules` it finds. `runGjsBundle()` calls it with both `process.cwd()` and `dirname(bundlePath)`, deduping by package name (CWD shadows bundle).
* **showcases/express-webserver:** declare `@gjsify/http-soup-bridge` as a runtime `dependencies` entry. It was previously only available transitively via `@gjsify/node-globals` at *build time*, so `npm install` of the published showcase tarball never shipped the typelib. The detection fix above plus this shape fix together make `gjsify showcase express-webserver` work after a clean dlx install.

### Refactors

* **cli:** drop `resolveNativePackages` + `findNearestPackageJson` from `utils/detect-native-packages.ts` (transitive-blind). One algorithm, two startpoints — see above.
* **cli:** extract `computeNativeEnvForBundle(bundlePath, cwd)` from `runGjsBundle` as a pure function — returns the `{ env, envPrefix }` it would inject into `gjs`. Lets the e2e tests assert the env without spawning gjs.

### Tests

* New e2e suite `dlx-native-prebuilds/` (2 tests): synthetic consumer with `@gjsify/http-soup-bridge` installed in node_modules + a bundle in a nested package dir, asserts that `computeNativeEnvForBundle` populates `GI_TYPELIB_PATH` / `LD_LIBRARY_PATH` from the bundle-side walk alone (CWD has no node_modules — the regression case).
* `tests/e2e/inline-static-reads/run.mjs`: added `--no-minify` since the test asserts inlined fixture content via property-name substring matches that the default-on minifier would mangle.

## [0.3.16](https://github.com/gjsify/gjsify/compare/v0.3.15...v0.3.16) (2026-05-08)

### Features

* **rolldown-plugin-gjsify:** bundle [@imports](https://github.com/imports) + flatten nesting in css-as-string ([6ea0b46](https://github.com/gjsify/gjsify/commit/6ea0b460ed567be07c4d18c3bf352b908ca039af))

## Unreleased — CSS bundling + GTK4 nesting flatten (2026-05-08)

### Features

* **rolldown-plugin-gjsify:** `cssAsStringPlugin` resolves `@import` and lowers nesting/modern syntax via lightningcss `bundleAsync`. `--app gjs` passes `targets: { firefox: 60 << 16 }` so authored CSS lands as the flat-selector subset GTK4's CSS engine accepts. Drops the previous "run a preprocessor ahead of `gjsify build`" caveat for the common GJS app case.

### Tests

* New e2e suite `css-bundling/` (1 test): asserts `@import`s are inlined and `&`-nesting flattens to compound selectors in the bundled string.

## [0.3.15](https://github.com/gjsify/gjsify/compare/v0.3.14...v0.3.15) (2026-05-07)

### ⚠ BREAKING CHANGES

* drops support for GJS 1.84 / SpiderMonkey 128
(Fedora 42). Minimum supported runtime is now GJS 1.86 / SM 140.
Rolldown JS target moves from firefox128 to firefox140, exposing
SM140-only features (Iterator helpers, Error.captureStackTrace
native, import...with{type:"json"}, Temporal preview, …) to user
bundles. CI matrix drops Fedora 42 (kept: Fedora 43/44).

Updated docs (README, AGENTS.md, STATUS.md, getting-started,
development-setup, how-it-works, cli-reference, architecture,
dlx-packaging) and inline comments to reflect the new baseline.
The 4-arg GLib.timeout_add workaround in @gjsify/node-globals
loses its Fedora-42 rationale but stays — the typing-vs-runtime
divergence still spams warnings on 1.86+.

### Features

* bump minimum runtime to GJS 1.86 / SpiderMonkey 140 ([#85](https://github.com/gjsify/gjsify/issues/85)) ([bd68ae0](https://github.com/gjsify/gjsify/commit/bd68ae0ec1b636ec2681649749b87b096a12d9bb))
* **cli:** add Flatpak-toolchain bundler primitives (PR1/6) ([328f5fb](https://github.com/gjsify/gjsify/commit/328f5fb330cd3fbb8922ac9bc759e62c61000365))
* **cli:** gjsify flatpak {init,build,deps,ci} subcommands (PR2/6) ([bbd9d74](https://github.com/gjsify/gjsify/commit/bbd9d74617622b5a5883ec2a86110837b623df81))
* **cli:** gjsify install -g <pkg> — XDG-style global install with sh launchers ([feee903](https://github.com/gjsify/gjsify/commit/feee903b42b5e7807f7764017e2cb6f31da94c32))

## Unreleased — Flatpak-toolchain PR2 (2026-05-07)

### Features

* **cli:** add `gjsify flatpak <subcommand>` group with four subcommands: `init`, `build`, `deps`, `ci`. Consolidates the Flatpak workflow that was previously spread across hand-written `<app-id>.json` manifests and project-local `build-flatpak.sh` shell scripts. Designed to ship both GUI apps (default) and headless CLI tools (`gjsify flatpak init --cli-only`) — both keep `org.gnome.Platform` runtime since GJS bundles need GLib/GIO at runtime, only finish-args change.
* **cli:** new `gjsify.flatpak` config namespace (`ConfigDataFlatpak` interface) — `appId`, `runtime` (`gnome` or `freedesktop`), `runtimeVersion`, `sdkExtensions`, `appendPath`, `command`, `finishArgs`, `extraModules`, `cleanup`, `lockfile`, `ciContainer`, `ciBranches`. Read by `init` and `ci` subcommands as defaults; CLI flags override.
* **cli/flatpak init:** generates `<app-id>.json`. SDK-Extension paths auto-derive into `build-options.append-path` (e.g. `org.freedesktop.Sdk.Extension.node24` → `/usr/lib/sdk/node24/bin`). Refuses to overwrite without `--force`.
* **cli/flatpak build:** wraps `flatpak-builder` with `--force-clean`, `--sandbox`, `--delete-build-dirs` defaults. Composable post-build steps: `--install`, `--repo`, `--bundle <out.flatpak>` (routes through `flatpak build-bundle`), `--tarball <out.tar.gz>`. Auto-detects the manifest by scanning cwd for the first `*.json` whose top-level shape has `id` + `runtime` + `modules`.
* **cli/flatpak deps:** wraps `flatpak-node-generator`. Auto-detects `yarn.lock` vs `package-lock.json` from filename; passes `--xdg-layout` by default. ENOENT hint points at `pipx install flatpak-node-generator`.
* **cli/flatpak ci:** scaffolds `.github/workflows/flatpak.yml` matching the `flatpak/flatpak-github-actions/flatpak-builder@v6` shape. Container image derived from `gjsify.flatpak.runtime` + `runtimeVersion`. Idempotent without `--force` — re-running with byte-identical content is a no-op.

### Tests

* Add `tests/e2e/flatpak/run.mjs` (7 tests). Stubs `flatpak-builder`, `flatpak-node-generator`, and `flatpak` on PATH so the suite exercises the full CLI surface without requiring the real tools (which need a privileged container). Verifies init manifest shape (GUI + CLI flavours), refuse-overwrite, ci YAML rendering, ci idempotency, deps invocation shape, build invocation shape.

## Unreleased — Flatpak-toolchain PR1 (2026-05-07)

### Features

* **cli:** add `gjsify gsettings <schemadir>` subcommand. Wraps `glib-compile-schemas` mirroring the existing `gresource` / `gettext` shape (`--strict`, `--targetdir`, `--verbose`, ENOENT hint). Lets package.json drop the npm-script-driven `glib-compile-schemas …` invocation.
* **cli:** add `defineFromPackageJson` and `defineFromEnv` config keys. Both resolve at config-load time and merge JSON-stringified values into `bundler.transform.define`. Replaces the wrapper-script pattern (`spawnSync('gjsify', ['build', '--define', '__VERSION__=' + JSON.stringify(pkg.version)])`) used by external consumers like `@ts-for-gir/cli` to inject build-time constants. `defineFromEnv` supports a `default` key; missing without default → identifier replaced with the literal `undefined` so consumer code can guard with `typeof X === 'undefined'`.
* **cli:** add `loaders: Record<string, 'text'>` config key. Currently only `'text'` is implemented (file content becomes a JS string default export). Replaces the legacy esbuild `loader: { '.ui': 'text', '.asm': 'text' }` shorthand. Implementation parallels `cssAsStringPlugin` — new `textLoaderPlugin` re-exported from `@gjsify/rolldown-plugin-gjsify`.
* **cli:** allow `bundler.plugins` entries to be specified by package name. New `BundlerPluginByName` shape (`{ name: string; export?: string; options?: unknown }`) is resolved via `createRequire(<projectDir>/package.json).resolve(name)` and instantiated with `options`. Lets `package.json#gjsify` describe the full plugin chain (e.g. `@gjsify/vite-plugin-blueprint` + `@gjsify/vite-plugin-gettext`) without dropping to a JS-form config file.
* **cli/rolldown-plugin-gjsify:** widen `shebang` config to `boolean | string`. String form supports `${env:NAME}` and `${env:NAME:-default}` placeholders against `process.env`; auto-prefixes `#!` when missing. New helpers `expandEnvTemplate` and `resolveShebangLine` re-exported from `@gjsify/rolldown-plugin-gjsify`. Required for Flatpak-driven builds where Meson exports `GJS_CONSOLE=/usr/bin/gjs-console`.

### Tests

* Add five e2e suites: `tests/e2e/{gsettings,define-from-pkg,text-loader,plugins-by-name,shebang-string}/`. Each wired into the chained `test:e2e` script and as a granular `test:e2e:<name>` script.

## [0.3.14](https://github.com/gjsify/gjsify/compare/v0.3.13...v0.3.14) (2026-05-07)

### Features

* **bundler:** migrate from esbuild to Rolldown ([#81](https://github.com/gjsify/gjsify/issues/81)) ([b9bc7a7](https://github.com/gjsify/gjsify/commit/b9bc7a71f4072e40ec8b003df1eb387e105678df)), closes [#PR](https://github.com/gjsify/gjsify/issues/PR)
* **cli:** swap engine from esbuild to Rolldown ([#83](https://github.com/gjsify/gjsify/issues/83)) ([7c3b08e](https://github.com/gjsify/gjsify/commit/7c3b08e9f2f46b870ce744fe6b7fb0a1b61e04c6))
* **rolldown-plugin-gjsify:** orchestrator package ([#82](https://github.com/gjsify/gjsify/issues/82)) ([2f5d660](https://github.com/gjsify/gjsify/commit/2f5d660674d94a6758288f37e650e98abd3224e7))

### Bug Fixes

* **rolldown-plugin-gjsify:** codeSplitting: false instead of inlineDynamicImports ([5985c7a](https://github.com/gjsify/gjsify/commit/5985c7aa6a580c1cab90310b9d9d9903a6194100))

## [0.4.0-pre](https://github.com/gjsify/gjsify/compare/v0.3.13...v0.4.0-pre) (2026-05-07)

### ⚠ BREAKING CHANGES

* **runtime:** minimum supported runtime is now **GJS 1.86 / SpiderMonkey 140** (Fedora 43+). GJS 1.84 / SpiderMonkey 128 (Fedora 42) is no longer tested or supported. The Rolldown JS target moves from `firefox128` to `firefox140` so SM140-only language features (Iterator helpers, `Error.captureStackTrace` native, `import...with{type:"json"}`, Temporal preview, …) are emitted unchanged. Consumer projects pinning `firefox128` in `.gjsifyrc.js` should bump to `firefox140`. CI matrix dropped Fedora 42; Fedora 43 (GJS 1.86) and Fedora 44 (GJS 1.88) remain.
* **bundler:** the build engine has been swapped from esbuild to **Rolldown** (Vite 8's production bundler). The CLI flag surface is preserved exactly (`gjsify build --app gjs|node|browser --globals auto …`), but `.gjsifyrc.js`'s `esbuild?: BuildOptions` field is renamed to `bundler?: RolldownOptions`. Setting the old `esbuild` field still works for one release (deprecation warning + key remap); drop in 0.5.0. The 6 esbuild-plugin packages are deleted — replaced by `@gjsify/{rolldown-plugin-gjsify, rolldown-plugin-deepkit, rolldown-plugin-pnp, vite-plugin-blueprint, vite-plugin-gettext}`. The new plugins are Rollup-shaped, so the same packages run under both `gjsify build` and Vite (sister GJS apps).

### Features

* **bundler:** migrate from esbuild to Rolldown ([#82](https://github.com/gjsify/gjsify/issues/82), [#83](https://github.com/gjsify/gjsify/issues/83)). `--globals auto` retains its iterative multi-pass "after tree-shaking" detection (bundler-agnostic invariant per AGENTS.md). Architectural cleanup: `__toCommonJS` patcher deleted (Rolldown emits real ESM); transform-ext plugin deleted (Rolldown library mode emits resolved imports natively); banner ordering declarative via `renderChunk(order: 'post')`; PnP rewriter and PnP loader become independent plugins (no more first-onLoad-wins workaround); CSS-as-string via `load` hook (Rolldown removed experimental CSS bundling).

### Bug Fixes (Rolldown migration follow-ups)

* **rolldown-plugin-gjsify:** `external` accepts string/RegExp/function but not glob patterns — replaced `'gi://*'` / `'@girs/*'` array entries with a `(id) => id.startsWith(…)` predicate so URI-scheme externals stay external in both `--app gjs` and `--app node` builds.
* **rolldown-plugin-gjsify:** console shim now uses `transform.inject` (Oxc-based, `Rolldown` equivalent of esbuild's `inject`) instead of a virtual-entry side-effect import. `globalThis.console` is non-configurable on SpiderMonkey 128 so a register-style global write throws; the side-effect-import shim never bound the named `console` export into user scope, leaving `console.log(…)` going through GLib's logger and `Gjs-Console-Message:` prefix.
* **rolldown-plugin-gjsify:** library mode externalises non-relative imports (workspace deps + `@girs/*` + `gi://*`) and derives `preserveModulesRoot` from the common ancestor of resolved entries — fixes `lib/esm/<srcRoot>/file.js` paths breaking the package.json `main` field for packages with `rootDir: "src/ts"`.
* **rolldown-plugin-gjsify:** virtual-entry `load` hook resolves the user-entry path through `this.resolve()` before re-exporting — bare-string paths like `src/index.ts` were treated as external specifiers and surfaced at runtime as `ImportError: Module not found: src/index.ts`.
* **rolldown-plugin-gjsify:** drop the top-of-bundle `createRequire` banner from Node ESM output. Rolldown handles bundled-CJS interop internally via `__commonJSMin` + `__require`; the banner collided with sources that declare their own `const require = createRequire(...)` (yargs's ESM platform shim) producing `SyntaxError: Identifier 'require' has already been declared`.
* **rolldown-plugin-pnp:** short-circuit `gi://` URIs before `pnpApi.resolveRequest` — `@girs/*` packages don't list `gi:` as a dep so PnP throws `UNDECLARED_DEPENDENCY` for every gi:// import. Returns `{ id, external: true }` instead.
* **cli:** preserve `bundler.input` when merging the legacy `esbuild` config field. The orchestrator-side merge helper strips `input`/`external` (correct when the orchestrator is the override source) but `normalizeBundlerOptions` was applying that helper to two user-config arguments — losing the entry points populated from the CLI's `entryPoints` positional args.
* **net:** add explicit `type` modifier to `SocketConnectOptions` / `ListenOptions` re-exports. Rolldown errors out with `[MISSING_EXPORT]` where esbuild silently dropped type-only exports.
* **webrtc-native:** `build:types` now uses `tsc -b --force`. TypeScript 6 with `composite: true + emitDeclarationOnly: true` skips emit when every import is treated as opaque (the package's only import is `gi://GjsifyWebrtc?version=0.1`, which TS skips as an absolute URI), leaving downstream `tsc` consumers without `lib/types/` to import from.
* **deps:** pin `@girs/*` versions to exact (drop carets). `@girs/gtk-4.0@4.23.0-4.0.0-rc.10` was published with peerDeps on rc.10 packages that never landed on npm; caret ranges let the resolver pick the broken version and every `npm install` in the e2e tests failed with `ETARGET No matching version found for @girs/libxml2-2.0@2.0.0-4.0.0-rc.10`. Pinning until upstream rc.10 is fully published.

## [0.3.13](https://github.com/gjsify/gjsify/compare/v0.3.12...v0.3.13) (2026-05-06)

### Features

* **module:** PnP-aware createRequire for Yarn-PnP workspaces ([#79](https://github.com/gjsify/gjsify/issues/79)) ([0dabb85](https://github.com/gjsify/gjsify/commit/0dabb8590d852be4a71c473b123cff707dfbd7ab))

## [0.3.12](https://github.com/gjsify/gjsify/compare/v0.3.11...v0.3.12) (2026-05-06)

### Bug Fixes

* **cli,esbuild-plugin-gjsify:** library multi-build emitted ESM into the CJS outdir ([#77](https://github.com/gjsify/gjsify/issues/77)) ([bd7b98d](https://github.com/gjsify/gjsify/commit/bd7b98d8d3dbb1e5f29722bd75380cc911ec8f16)), closes [package.json#main](https://github.com/gjsify/package.json/issues/main)

## [0.3.11](https://github.com/gjsify/gjsify/compare/v0.3.10...v0.3.11) (2026-05-06)

### Bug Fixes

* **esbuild-plugin-gjsify:** hoist shebang, stub zip-only createRequire, skip zip URL rewrite ([#75](https://github.com/gjsify/gjsify/issues/75)) ([a8b7e08](https://github.com/gjsify/gjsify/commit/a8b7e0898ea383b744dda1df07dfab869c26aa49))

## [0.3.10](https://github.com/gjsify/gjsify/compare/v0.3.9...v0.3.10) (2026-05-06)

### Features

* **esbuild-plugin-gjsify:** inline static readFileSync at build time ([#74](https://github.com/gjsify/gjsify/issues/74)) ([784ac8c](https://github.com/gjsify/gjsify/commit/784ac8c54a7f520909b66d049595575a3749e334)), closes [#72](https://github.com/gjsify/gjsify/issues/72)

## [0.3.9](https://github.com/gjsify/gjsify/compare/v0.3.8...v0.3.9) (2026-05-05)

### Bug Fixes

* **cli,esbuild-plugin-gjsify:** merge config sources, outfile safety, PnP-zip warning ([#70](https://github.com/gjsify/gjsify/issues/70)) ([684cbe4](https://github.com/gjsify/gjsify/commit/684cbe4aea2062bed59568edaecff6237d9dd1ec)), closes [#378](https://github.com/gjsify/gjsify/issues/378) [#378](https://github.com/gjsify/gjsify/issues/378)

## [0.3.8](https://github.com/gjsify/gjsify/compare/v0.3.7...v0.3.8) (2026-05-05)

### Features

* native install backend + dlx polish (no Node/npm at runtime) ([#69](https://github.com/gjsify/gjsify/issues/69)) ([c9ac876](https://github.com/gjsify/gjsify/commit/c9ac876a2f687ce95d50a0eff371c97676879eb8))

## [0.3.7](https://github.com/gjsify/gjsify/compare/v0.3.6...v0.3.7) (2026-05-05)

### Bug Fixes

* **cli,esbuild-plugin-gjsify,resolve-npm:** rewriter composes into pnp onLoad (v0.3.7) ([#68](https://github.com/gjsify/gjsify/issues/68)) ([00f3dc9](https://github.com/gjsify/gjsify/commit/00f3dc95b0c2c4a7cabaa502a948ab73b641ef7a)), closes [#378](https://github.com/gjsify/gjsify/issues/378)

## [Unreleased] — 2026-05-05 — v0.3.7 PnP-rewriter onLoad ordering fix

### Bug Fixes

* **cli, esbuild-plugin-gjsify, resolve-npm:** the `__filename`/`__dirname` rewriter for CJS code in `node_modules` is now composed INTO the `@yarnpkg/esbuild-plugin-pnp` plugin's `onLoad`, not registered as a parallel `namespace: "pnp"` `onLoad`. Esbuild stops at the first matching `onLoad` and the pnp plugin (registered first) always wins, so the parallel registration never fired — bundles under `nodeLinker: pnp` shipped with no `__filename` injection and crashed at module load with `ReferenceError: __filename is not defined` (typescript.js's `swapCase(__filename)` was the canonical reproducer).
* **esbuild-plugin-gjsify:** export `rewriteContents` and `getBundleDir` from `@gjsify/esbuild-plugin-gjsify` so the rewriter can be invoked on already-loaded contents from inside another plugin's `onLoad`. The `pnp` namespace `build.onLoad` registration in `registerNodeModulesPathRewrite` was removed — it was dead code.

### Features

* **resolve-npm:** new `@gjsify/resolve-npm/pnp-relay` subpath. Exports `getPnpPlugin({ transformContentsFactory, issuerUrl })` — the gjsify-flavoured PnP plugin previously buried inside `@gjsify/cli`. The factory pattern lets callers wire a per-build content transformer (e.g. the `__filename` rewriter) directly into the pnp `onLoad`. `issuerUrl` anchors the relay on the caller's installation so transitive `@gjsify/*` polyfills resolve through whoever called `getPnpPlugin`. `@gjsify/cli`'s `actions/build.ts` now delegates to this helper.

### Tests

* **e2e:** added a `__filename` injection regression to `tests/e2e/cli-only-pnp/run.mjs` (5/5 ✓). Bundles a minimal CJS module from a `node_modules`-named fixtures directory that uses `__filename`, runs the bundle under `gjs`, and asserts `__filename` resolves to the fixture path. Reverting the rewriter composition (or returning `undefined` from `transformContents`) makes the test fail with the original error message.

### Internal

* **packages/infra/cli:** add `@gjsify/resolve-npm` as a direct dep (was previously only reached transitively via `@gjsify/esbuild-plugin-gjsify`'s re-export).
* **esbuild-plugin-deepkit:** comment now explicitly distinguishes the dual-format ESM path (`@deepkit/type-compiler`'s `default` export) from the CJS-virtual case (`pnpapi`) — pointer to `pnp-relay.mjs` for the `.default ?? mod` unwrap pattern.

## [0.3.6](https://github.com/gjsify/gjsify/compare/v0.3.5...v0.3.6) (2026-05-05)

### Bug Fixes

* **cli,plugin-gjsify,plugin-deepkit:** PnP external-consumer relay actually works (v0.3.6) ([#67](https://github.com/gjsify/gjsify/issues/67)) ([edcc9a1](https://github.com/gjsify/gjsify/commit/edcc9a110b90e4ca1119a78fb19bbf09979334b7)), closes [#378](https://github.com/gjsify/gjsify/issues/378)

## [Unreleased] — 2026-05-05 — v0.3.6 PnP-external-consumer fixes

### Bug Fixes

* **cli:** unwrap `await import("pnpapi")` ESM namespace before use. The dynamic import returns `{ default, "module.exports" }` for CJS modules — so `pnpApi.resolveRequest(...)` was `undefined` and every two-hop relay attempt threw a `TypeError` that the surrounding `catch {}` swallowed. The relay shipped in v0.3.5 looked correct in source but was a silent no-op in production. Fix: `(mod as { default?: PnpApi }).default ?? mod` in `packages/infra/cli/src/actions/build.ts`.
* **esbuild-plugin-gjsify:** declare `esbuild` as `peerDependencies` so external Yarn-PnP consumers no longer hit `UNDECLARED_DEPENDENCY: esbuild` on the very first build. Previously esbuild was reachable only via gjsify's own root-`.yarnrc.yml` `packageExtensions` workaround — invisible to npm-installed consumers.
* **esbuild-plugin-deepkit:** lazy-import `@deepkit/type-compiler` (and lazy-instantiate `DeepkitLoader`) so consumers with `reflection: false` (the default) never resolve the deepkit module. Eager-loading transitively required `typescript` from `@marcj/ts-clone-node` (which doesn't declare TS as a peer), failing PnP consumers with `UNDECLARED_DEPENDENCY: typescript` even when reflection was opt-in disabled. `transformExtern` is now async; no internal callers, so the API change is non-breaking in practice.

### Tests

* **e2e:** new `tests/e2e/cli-only-pnp/run.mjs` (4/4 ✓) — Yarn-PnP variant of `cli-only/`. Installs only `@gjsify/cli` + `@gjsify/empty` from packed tarballs under `nodeLinker: pnp`, builds scripts importing `node:fs` / `node:path` / `node:child_process` / `node:events`, asserts the relay resolves all four through `@gjsify/node-polyfills`. Reverting any of the three fixes above causes the test to fail with the original error message — this is the regression-detector that should have caught the v0.3.5 ship. Wired into `package.json#test:e2e`. New helper `setupProjectYarnPnp()` + `hasCommand()` in `tests/e2e/helpers.mjs`.

## [0.3.5](https://github.com/gjsify/gjsify/compare/v0.3.4...v0.3.5) (2026-05-05)

### Features

* **cli:** gjsify dlx — GJS-bundle runner for npm-published packages ([#65](https://github.com/gjsify/gjsify/issues/65)) ([0e31170](https://github.com/gjsify/gjsify/commit/0e3117071cce83b7095d2ddb7ec51eee9e7a6eee)), closes [package.json#main](https://github.com/gjsify/package.json/issues/main)

## [Unreleased] — Phase A bug fixes for v0.3.5

### Bug Fixes

* **esbuild-plugin-gjsify:** `rewrite-node-modules-paths` handles Yarn PnP zip-cached files. Skips paths fs.readFile cannot open and registers the rewrite hook for the `pnp` namespace too — bundled `typescript.js` from a PnP zip no longer crashes with `ReferenceError: __filename is not defined`.
* **cli:** `getPnpPlugin` two-hop relay now resolves through the polyfill packages' `package.json` paths instead of their `main`. The meta polyfills have no `main`/`module` field, so the previous resolution fell back silently and missed every transitive `@gjsify/*` register subpath. External consumers no longer need to redeclare each `@gjsify/<pkg>` as a direct devDep.
* **cli:** `--shebang` no longer overrides `shebang: true` from `.gjsifyrc.js`. Yargs' `default: false` made `cliArgs.shebang` always defined, which clobbered the config-file value through the `if (cliArgs.shebang !== undefined)` merge.

### Features

* **webassembly:** new `@gjsify/webassembly` package — Promise-API polyfill that wraps SpiderMonkey 128's working synchronous `new WebAssembly.Module(buffer)` / `new WebAssembly.Instance(module, imports)` constructors. Replaces `WebAssembly.{compile,compileStreaming,instantiate,instantiateStreaming,validate}` (which throw `WebAssembly Promise APIs not supported in this runtime` on first call). 15 tests pass on both Node + GJS.
* **resolve-npm:** `WebAssembly` added to `GJS_GLOBALS_GROUPS.web` and `GJS_GLOBALS_MAP`. `--globals auto` injects the polyfill whenever `WebAssembly.{compile,instantiate,validate}` etc. appear in the bundle (via new `METHOD_MARKERS` in `detect-free-globals.ts`).

## [0.3.4](https://github.com/gjsify/gjsify/compare/v0.3.3...v0.3.4) (2026-05-04)

### Features

* **ts-for-gir Phase 6/6b/8:** portable import.meta.url + TypeDoc + language-server tests ([624f0cf](https://github.com/gjsify/gjsify/commit/624f0cf8a6dd283157f00c5ff7f6a430cc49c407))

## [Unreleased] — 2026-05-04

### Features

* **esbuild-plugin-gjsify:** rewrite `import.meta.url` in node_modules to build-time-known file URLs (Rollup CJS-polyfill pattern), enabling TypeDoc's eager filesystem reads to resolve via gjsify's GLib-backed `fs` polyfill at runtime
* **module:** `createRequire` walks all ancestor `node_modules` directories (matches Node.js resolution algorithm), fixing packages in a parent `node_modules` being unreachable when a closer `node_modules` exists but doesn't contain the requested package
* **ts-for-gir Phase 6:** TypeDoc stubs removed — `ts-for-gir json` and `ts-for-gir doc` work natively on GJS; 10 new tests (json/doc `--help` on Node + GJS, both run-from-Node and run-from-GJS); Node: 249/249, GJS: 209/209

---

## [0.3.3](https://github.com/gjsify/gjsify/compare/v0.3.2...v0.3.3) (2026-05-04)

### Bug Fixes

* **cli:** fall through on UNDECLARED_DEPENDENCY in Yarn PnP onResolve ([6c3b712](https://github.com/gjsify/gjsify/commit/6c3b7121ad256ea1e536f6030c8fb272ff7587a2))

## [0.3.2](https://github.com/gjsify/gjsify/compare/v0.3.1...v0.3.2) (2026-05-04)

### Features

* Yarn PnP support, excludeGlobals, fetch bridge-free ([#61](https://github.com/gjsify/gjsify/issues/61)) ([bf7d936](https://github.com/gjsify/gjsify/commit/bf7d93648bdd877107725bdf28d63fdf552c2935))

## [0.3.1](https://github.com/gjsify/gjsify/compare/v0.3.0...v0.3.1) (2026-05-04)

### Bug Fixes

* **esbuild-plugin-gjsify:** preserve caller plugins in detectAutoGlobals analysis passes ([33ccd48](https://github.com/gjsify/gjsify/commit/33ccd48aa2943e6bb1d43c97fb53eccd9d909ec2))

## [0.3.0](https://github.com/gjsify/gjsify/compare/v0.2.0...v0.3.0) (2026-05-04)

### Features

* **terminal-native:** optional Vala prebuild for real Linux terminal syscalls ([#60](https://github.com/gjsify/gjsify/issues/60)) ([d58a20a](https://github.com/gjsify/gjsify/commit/d58a20a95c7eb095e718cf23a2843f8d475816d6))

## [Unreleased] — 2026-05-02

### Features

* **terminal-native:** new optional Vala prebuild `@gjsify/terminal-native` with real Linux terminal syscalls (Posix.isatty, ioctl TIOCGWINSZ, termios raw mode, SIGWINCH ResizeWatcher). Loaded via synchronous `imports.gi.GjsifyTerminal` try/catch — no crash when typelib not installed.
* **tty:** `isatty()` now uses `Posix.isatty()` via terminal-native (GLib fallback). `getWindowSize()`/`columns`/`rows` use `ioctl TIOCGWINSZ` (env/default fallback). `setRawMode()` uses `tcgetattr/tcsetattr` (no-op fallback).
* **process:** `stdin`, `stdout`, `stderr` replaced with `ProcessReadStream`/`ProcessWriteStream` (isTTY, setRawMode, columns, rows). SIGWINCH wired to stdout/stderr `'resize'` event via `ResizeWatcher`.
* **e2e/terminal-native:** new E2E test suite `tests/e2e/terminal-native/` — 16/16 green (with + without native core module).

## [0.2.0](https://github.com/gjsify/gjsify/compare/v0.1.15...v0.2.0) (2026-05-01)

### Features

* **@gjsify/fetch + integration:** axios integration suite + double-decompression fix ([#54](https://github.com/gjsify/gjsify/issues/54)) ([a09bf9b](https://github.com/gjsify/gjsify/commit/a09bf9b9ebaeec2dc4ac77bf8bb39f747a6852ca))
* **@gjsify/fs:** add fs.promises.watch() as AsyncIterableIterator ([#51](https://github.com/gjsify/gjsify/issues/51)) ([f2ef61d](https://github.com/gjsify/gjsify/commit/f2ef61dd9b5b446586ced9ac7338e885eeb16183))
* **@gjsify/fs:** add watchFile/unwatchFile and statfsSync/statfs/promises.statfs ([#52](https://github.com/gjsify/gjsify/issues/52)) ([5fe86ed](https://github.com/gjsify/gjsify/commit/5fe86edc75abb608f487370ddac0b86e2c47e85d))
* **@gjsify/fs:** complete fs — utimes/lutimes/lchown/lchmod, all fd-ops, FileHandle stubs ([#53](https://github.com/gjsify/gjsify/issues/53)) ([2908669](https://github.com/gjsify/gjsify/commit/29086697723fadfe901c06e0ef5456203cd4cf37))
* **@gjsify/fs:** implement cp, Dir/opendir, and globSync/glob/promises.glob ([#50](https://github.com/gjsify/gjsify/issues/50)) ([4975f89](https://github.com/gjsify/gjsify/commit/4975f8983a583216ad3f9b5f4d1a67a4246bb7aa))
* **@gjsify/v8:** promote Stub → Partial with real heap stats and V8 wire-format serdes ([#54](https://github.com/gjsify/gjsify/issues/54)) ([e9e92fe](https://github.com/gjsify/gjsify/commit/e9e92fed9f2a5dd3e395a1cd5db355e59756c2ac))
* **deps:** add @gjsify/crypto workspace dependency ([8f03007](https://github.com/gjsify/gjsify/commit/8f03007d3518d090cd7fccd8fc38823737b78724))
* **example/cli-axios-http-client:** rewrite around jsonplaceholder.typicode.com (real HTTPS) ([ce9a512](https://github.com/gjsify/gjsify/commit/ce9a512ece293674e6778b5673df8756f5015df6))
* **examples:** add MCP server and client examples ([61336ef](https://github.com/gjsify/gjsify/commit/61336ef5216ee48d5312a4840166214ed751a87e))
* **examples:** add SQLite todo store cross-validated on GJS and Node.js ([6803555](https://github.com/gjsify/gjsify/commit/680355516d187c478104d2d9c49577a66563dc60))
* **examples:** socket.io ping-pong + chat-server examples + fix zlib TS errors ([26d9553](https://github.com/gjsify/gjsify/commit/26d95531804a94b71bdcb6247c1919b21c2f98d0))
* **framework:** new packages/framework pillar + @gjsify/adw-app ([252386a](https://github.com/gjsify/gjsify/commit/252386a7b71389947bc2c82463ba75ee05260d11))
* **http-soup-bridge:** new Vala bridge package wrapping Soup.Server ([eea4862](https://github.com/gjsify/gjsify/commit/eea4862aacd34ae7acd5757abcbaef528714d0b6))
* **http2:** implement Soup 3.0-backed compat + session API (Phase 1) ([a271401](https://github.com/gjsify/gjsify/commit/a271401959d8bb65ffa08adc8585b791eff4091b))
* **http2:** update yarn.lock with new [@girs](https://github.com/girs) dependencies for compatibility ([e4a31ce](https://github.com/gjsify/gjsify/commit/e4a31ceb64e910af1f188861e03816716af6c243))
* **integration/mcp:** add Streamable HTTP transport tests ([73dd84b](https://github.com/gjsify/gjsify/commit/73dd84b3e59a6e40ae47cde113f5724ff362a158))
* **integration/ts-for-gir:** @ts-for-gir/cli@4.0.0-rc.8 on GJS via async-safe @gjsify/process.exit ([#58](https://github.com/gjsify/gjsify/issues/58)) ([24414f3](https://github.com/gjsify/gjsify/commit/24414f3c015f2265ad83267aa25e35dee2ae613c))
* **integration/ts-for-gir:** Phase 1 — [@gi](https://github.com/gi).ts/parser on GJS ([#55](https://github.com/gjsify/gjsify/issues/55)) ([f26a61f](https://github.com/gjsify/gjsify/commit/f26a61f55ddb02a3aab19252a55a4dca4ad9bba9))
* **integration/ts-for-gir:** Phase 4a — non-interactive @ts-for-gir/cli on Node + supporting infra ([#57](https://github.com/gjsify/gjsify/issues/57)) ([7973f3d](https://github.com/gjsify/gjsify/commit/7973f3d547118c6ec1bb0dad9380b4107449e7f4))
* **integration/ts-for-gir:** Phases 2+3 — @ts-for-gir/lib type system + generator pipeline on GJS ([#56](https://github.com/gjsify/gjsify/issues/56)) ([066e431](https://github.com/gjsify/gjsify/commit/066e431e5f6bf184ada5157c101aa21ab2e17753))
* **integration:** add MCP TypeScript SDK integration tests ([757697c](https://github.com/gjsify/gjsify/commit/757697cd3b6d2078a0894b92c1546aa8ff112ea2))
* **integration:** socket.io 20/20 on GJS + 3 root-cause fixes in events/fetch/http/stream ([97dcc7f](https://github.com/gjsify/gjsify/commit/97dcc7f3e60fc396dc51ab0d0888f60a6ddce3fb))
* **integration:** webtorrent integration test pillar + 3 root-cause fixes ([b571b53](https://github.com/gjsify/gjsify/commit/b571b53807ca9b3b5ed3a4b458a16ae2c27282d3))
* **node/ws:** drop-in @gjsify/ws wrapper over Soup WebsocketConnection ([b11304c](https://github.com/gjsify/gjsify/commit/b11304c03ee7eb7a971661253b3e886dc53482ce))
* **socket.io-examples:** enable WebSocket transport + add READMEs ([706de51](https://github.com/gjsify/gjsify/commit/706de51e42a761965393c9f80fcba0e950a59362))
* **socket.io:** port socket.spec.ts + namespaces.spec.ts; fix WebSocket-only transport ([83f2db5](https://github.com/gjsify/gjsify/commit/83f2db5ffad906021cad34f2130cb9b79ce74bbf))
* **tests-integration,websocket:** Autobahn Testsuite pillar + /register subpath ([221db35](https://github.com/gjsify/gjsify/commit/221db35bf0737370012fd5be3b63a8ace25d42b5))
* **tests-integration:** enable Autobahn 9.* performance suite ([720ed04](https://github.com/gjsify/gjsify/commit/720ed04896cc3dba7cdaa3d89e35ed50e75bc853))
* **tests/browser:** add browser tests for dom-elements and canvas2d-core ([7a843f4](https://github.com/gjsify/gjsify/commit/7a843f43982dcaed048204f9795d8c527c86387c))
* **tests/browser:** add Playwright browser test infrastructure for Web/DOM packages ([5506b60](https://github.com/gjsify/gjsify/commit/5506b60062c125a9fcf3e764a94b1c56195f0eef))
* **tests:** add streamx integration test suite (155 Node + 156 GJS tests) ([a975669](https://github.com/gjsify/gjsify/commit/a975669425d86d874c4d60473fcb19c251b1d5e1))
* **video:** GstHTMLVideoElement + VideoBridge controls + two new examples ([#24](https://github.com/gjsify/gjsify/issues/24)) ([82e32b5](https://github.com/gjsify/gjsify/commit/82e32b51aefc7243e522bd2cbcd36582ab4d4db2)), closes [#0](https://github.com/gjsify/gjsify/issues/0) [#1](https://github.com/gjsify/gjsify/issues/1) [#2](https://github.com/gjsify/gjsify/issues/2) [#18](https://github.com/gjsify/gjsify/issues/18)
* **websocket,tests-integration:** permessage-deflate + Autobahn baseline expansion ([74487bc](https://github.com/gjsify/gjsify/commit/74487bcdd44ce91d38eefcaee9654129a467bc49)), closes [#30](https://github.com/gjsify/gjsify/issues/30)
* **websocket:** implement headers, origin, handshakeTimeout client options ([a2bb775](https://github.com/gjsify/gjsify/commit/a2bb775c42876e014bacb1af075c11db81b6a8fa))
* **ws,net,http:** WebSocket server Phase 3 — noServer+handleUpgrade+'headers' event ([93f4980](https://github.com/gjsify/gjsify/commit/93f498005b1439d4329ebdc907b5bbb61b5d1678))
* **ws:** implement createWebSocketStream + update docs ([09249a3](https://github.com/gjsify/gjsify/commit/09249a36da62024183b13c320f4e51f4f86ede1c))
* **ws:** WebSocket server hooks Phase 2 — verifyClient, handleProtocols, { server } mode ([a11a041](https://github.com/gjsify/gjsify/commit/a11a04197d6084567a55de3b99aadf9c85370271))

### Bug Fixes

* **@gjsify/unit:** add browserSignalDone — 13/13 browser tests green ([#48](https://github.com/gjsify/gjsify/issues/48)) ([0a81e1f](https://github.com/gjsify/gjsify/commit/0a81e1fe9fb28f52e42e914b08126bb6902eafb9))
* **child_process:** add ensureMainLoop() to spawn/exec/execFile — fix GJS-from-GJS subprocess deadlock (Phase 5) ([#59](https://github.com/gjsify/gjsify/issues/59)) ([2f04633](https://github.com/gjsify/gjsify/commit/2f046335682d844e3a85b64c506342b5be0dda6c))
* **child_process:** spawn() sets child.stdout/stderr as GioInputStreamReadable ([#49](https://github.com/gjsify/gjsify/issues/49)) ([8b3feac](https://github.com/gjsify/gjsify/commit/8b3feaceb0ff7ba7e6bf7352856fc2697c8f8900))
* **ci:** upgrade riscv64 base image to ubuntu:26.04 ([9484cf3](https://github.com/gjsify/gjsify/commit/9484cf3ef06878a58017da5e85343db47d8a3c2f))
* **dgram:** reject mismatched-family sends with EINVAL before hitting Gio ([280bbfa](https://github.com/gjsify/gjsify/commit/280bbfae7348eb3c115e72edd7dc659f6ddcda31))
* **esbuild-plugin-gjsify:** add resolveDir to __dirname onLoad result ([eec66e9](https://github.com/gjsify/gjsify/commit/eec66e92000683f0ea4c7c787c114faaadbd9fa5))
* **esbuild-plugin-gjsify:** fix random-access-file 'not a directory' build error ([5105dfa](https://github.com/gjsify/gjsify/commit/5105dfa0d004382ba18dd1da3b89f7f29694b406))
* **esbuild-plugin-gjsify:** inject __dirname/__filename for CJS node_modules ([d2471c0](https://github.com/gjsify/gjsify/commit/d2471c0c8ce6ca51da6f542dd986fb86415e8f27))
* **esbuild-plugin-gjsify:** use build.resolve for random-access-file redirect ([79e3009](https://github.com/gjsify/gjsify/commit/79e3009649ef9edaff1b51509fcf61ca03eb52e6))
* **example/cli-axios-http-client:** explicit process.exit(0) so GJS returns to shell ([d1a8b45](https://github.com/gjsify/gjsify/commit/d1a8b4542fd027fbc397b44704e7ceaf861dd3c9))
* **examples/mcp:** fix net-mcp-server session handling ([eb235f8](https://github.com/gjsify/gjsify/commit/eb235f8a06b4fed748aa14fc88af8a7de8dd57ef))
* **examples/mcp:** fix TS2339 union type in cli-mcp-client ([55c2eb4](https://github.com/gjsify/gjsify/commit/55c2eb442952c2405626d13cc785f20bd890e2de))
* **examples/mcp:** hold McpServer per session and use explicit resource path ([05b66cb](https://github.com/gjsify/gjsify/commit/05b66cb59ca278703adaa4170e8d7c0a086ec65d))
* **examples:** chat-server use CDN for socket.io client, serveClient: false ([eed71a3](https://github.com/gjsify/gjsify/commit/eed71a32d6cfd07acc8d820391a4ffeadd4e2552))
* **fetch,url,webrtc,webaudio:** XHR responseType + URL.createObjectURL at the source (unblocks Excalibur showcase audio) ([604f6fa](https://github.com/gjsify/gjsify/commit/604f6fae9454fa484da7d8e1b25230d6a57c224a))
* **fetch:** xhr.ts pass headersInit record directly, remove unused Headers import ([0557244](https://github.com/gjsify/gjsify/commit/0557244c0e3c3aa8cde88bff7838f8d0ba0efea1))
* **fs,stream:** serialize concurrent I/O to clear GIO_ERROR_PENDING ([2ad9471](https://github.com/gjsify/gjsify/commit/2ad94714dc2f7fd8f508589a420891a97fdd075f))
* **fs:** convert ReadStream and FileHandle to async Gio I/O ([c74c34a](https://github.com/gjsify/gjsify/commit/c74c34af8fb116c4898c289ea8a6b8cbc8b50aaf))
* **fs:** use _construct() for async ReadStream file open; add regression tests ([e75fab7](https://github.com/gjsify/gjsify/commit/e75fab7f89190a4222dce89c11b05450a39e10f6))
* **globals:** inject timer override into bundles via auto-globals ([0a4af05](https://github.com/gjsify/gjsify/commit/0a4af052c565d8f941404e373edc09eae05ec664))
* **http-soup-bridge:** hand-written ambient types instead of @girs/ ([4f42cc8](https://github.com/gjsify/gjsify/commit/4f42cc8e4a6ed5bb596097dc46a2b3fb88577a6f))
* **http-soup-bridge:** throw GLib.Error from listen() so JS gets EADDRINUSE ([fc73142](https://github.com/gjsify/gjsify/commit/fc731426b6a0f25a0637b700631cd97297666e82)), closes [#44](https://github.com/gjsify/gjsify/issues/44)
* **http,net,fetch:** make HTTP server lifecycle GJS-GC-safe and Hono-compatible ([ff4959f](https://github.com/gjsify/gjsify/commit/ff4959f38e6de02a8e93db1b7b724cc5bc10c28c))
* **http2:** use npm version ranges for @girs/* deps (not workspace:^) ([60c5055](https://github.com/gjsify/gjsify/commit/60c5055b920286bfdad8e398e74ef127386e413f))
* **http:** map Gio listen errors to EADDRINUSE + default start to GJS ([8374b34](https://github.com/gjsify/gjsify/commit/8374b344815b45fcdb95aa752ee932e2b97aaef7))
* **http:** restore broad upgrade-intercept condition, keep req.socket before block ([4675156](https://github.com/gjsify/gjsify/commit/4675156e9ca95e1aa4837c41ef6d9ab5e7e33f77))
* **integration/mcp:** fix API signatures and GJS URL normalization ([d94324f](https://github.com/gjsify/gjsify/commit/d94324f671c8adae4a796ade6189deb280f38dae))
* **integration/mcp:** fix TS2339 union type access on resource contents ([28edde7](https://github.com/gjsify/gjsify/commit/28edde72d250df9445d3bb10714f90cf0ff92360))
* **net-ws-server:** correct subprotocol to chat.v1, fix build:public idempotency ([4e29eb3](https://github.com/gjsify/gjsify/commit/4e29eb3877756bcaf4161a824c3e2adc1b338501))
* **net:** yield to GLib idle between socket reads to prevent GTK freeze ([03f9389](https://github.com/gjsify/gjsify/commit/03f93895df57d4f37a815730f649f4d9145f7e33))
* **process:** revert nextTick to microtask semantics ([cc953c7](https://github.com/gjsify/gjsify/commit/cc953c709a71f00de301e4c8635fc742a5bdee64))
* remove surplus null arg from GLib.timeout_add calls in excalibur tests ([496fa78](https://github.com/gjsify/gjsify/commit/496fa78eb7c63dbc211f097375aba04ebaeab06b))
* remove surplus null user_data arg from GLib.timeout_add/idle_add calls ([ba8aa76](https://github.com/gjsify/gjsify/commit/ba8aa76e38d71806305fa7006ec062c3fe2f1295))
* replace (globalThis as any).X with direct imports in impl code ([40f7ea1](https://github.com/gjsify/gjsify/commit/40f7ea12dd960f4ca9994ca8b743694a82fe2ddc))
* **stream,fetch:** implement Readable.toWeb/fromWeb + fix fetch Content-Type ([6f422c6](https://github.com/gjsify/gjsify/commit/6f422c6c7bce00711ff3a1e6604518aae7f40d72))
* **stream:** drain write buffer synchronously when _write completes sync ([b7f6d5b](https://github.com/gjsify/gjsify/commit/b7f6d5be825cf89dacbafffff686a69c6b3fae99))
* **stream:** preserve FIFO write order across drain emit re-entry ([d85eff4](https://github.com/gjsify/gjsify/commit/d85eff4ffcfae2599a1326c74bcbc46ad69dbbe2)), closes [#0](https://github.com/gjsify/gjsify/issues/0)
* **stream:** store _err on destroy(), fix finished() for already-destroyed streams ([9cb6c42](https://github.com/gjsify/gjsify/commit/9cb6c4229f26ff4ca4a0e1a96d311802d08170b2))
* **tests/browser:** exclude test.browser.mts from tsc in dom packages ([91156f1](https://github.com/gjsify/gjsify/commit/91156f12d6913b70e38fadcd446f3e8572de7ee7))
* **tests/browser:** pass DOMMatrix2DInit with 2D-only props to setTransform ([4ca4d35](https://github.com/gjsify/gjsify/commit/4ca4d35487ff4d7fc2a3a3a719f4d9afb34e5293))
* **utils,process:** route nextTick through GLib idle to unfreeze GTK window ([9f077ca](https://github.com/gjsify/gjsify/commit/9f077caef63f2653bf4de9c463071dce8b2c6673))
* **utils:** batch nextTick bursts to keep GTK input events dispatching ([c9febdc](https://github.com/gjsify/gjsify/commit/c9febdc888a54a69a4cdf95ffe8c9367969b132a))
* **utils:** point GJS crash hint at GitHub issues, not internal STATUS.md ([4c7dbca](https://github.com/gjsify/gjsify/commit/4c7dbcaa494dfc5af11090b0f642efb34955e1af))
* **utils:** print G_DEBUG advisory at GJS HTTP startup; document MainContext race ([de5cd8d](https://github.com/gjsify/gjsify/commit/de5cd8d6f8ae7f1f05d93a5bd0641d1190e34db0))
* **web-streams:** use queueMicrotask instead of nextTick for pipeTo scheduling ([fec7abb](https://github.com/gjsify/gjsify/commit/fec7abbf5c11cdcba25c9c54f024470db178260f))
* **webgl:** cast TypedArray to number[] for @girs/gwebgl-0.1 compat ([509b6f1](https://github.com/gjsify/gjsify/commit/509b6f1d94192b617b463de5817170b474031392))
* **webgl:** remove stale dom/webgl/prebuilds after move to framework/ ([dba474d](https://github.com/gjsify/gjsify/commit/dba474de19a26ca3d2bf929455219efed4cc3045))
* **webrtc-native,webgl:** remove build:meson from default build script ([8f74ca2](https://github.com/gjsify/gjsify/commit/8f74ca274de07deef03f314719251cf1b3720560))
* **websocket:** make perMessageDeflate opt-in to fix unit test regressions ([dbdf236](https://github.com/gjsify/gjsify/commit/dbdf2363ffb8530d67ae1f42fc29597a75f353fc))
* **websocket:** preserve NUL bytes in text-frame sends ([0b548bf](https://github.com/gjsify/gjsify/commit/0b548bf527d17aa8c87320fa7c8e034082550f69))
* **websocket:** set max_incoming_payload_size to 100 MB + refresh Autobahn baselines ([cf1fd74](https://github.com/gjsify/gjsify/commit/cf1fd74e26ce00da763b6a39f52a5cc0e1cdf06a))
* **ws,net-ws-server:** remove double 'connection' emit in handleUpgrade path ([c5c12e0](https://github.com/gjsify/gjsify/commit/c5c12e06258428b24d8139ee8346cfb25419ed8e))
* **ws:** replace @gjsify/http import type with local structural interface ([a4157a9](https://github.com/gjsify/gjsify/commit/a4157a9601e8c6d035f8cc2aa80e908fa1495cff))
* **yarn:** add workspace reference for @gjsify/buffer ([9cfdea3](https://github.com/gjsify/gjsify/commit/9cfdea39e122f5759a28f45df332335aafba926e))

### Performance Improvements

* **excalibur-jelly-jumper:** add performance profiling + GJS vs browser comparison ([a5bd29d](https://github.com/gjsify/gjsify/commit/a5bd29d765df7d4ea81e7ef8110428eb467efca3))
* **excalibur-jelly-jumper:** finalize GJS config after A/B tests ([6cf9eb1](https://github.com/gjsify/gjsify/commit/6cf9eb1afec890b8776f963d8ce4dd26623d1d0e))
* **excalibur-jelly-jumper:** fix HUD visibility + reduce physics cascade ([5e1a55d](https://github.com/gjsify/gjsify/commit/5e1a55d8bed7def97c671a432e0be2be686dc93c))
* **excalibur-jelly-jumper:** improve comparison script hints based on real data ([5ad2b62](https://github.com/gjsify/gjsify/commit/5ad2b62df8e9f93c0ac9cc9ad2c767f61c5ff380))
* **excalibur-jelly-jumper:** reduce per-frame GC allocations ([0415007](https://github.com/gjsify/gjsify/commit/0415007ae9148180812fc98e9638fdfb2eaf47da))
* **excalibur-jelly-jumper:** tie [PERF] logging to F1 toggle ([ca6877d](https://github.com/gjsify/gjsify/commit/ca6877dd349d7cc4f5a0cdd22bbf791dce8126ee))
* **excalibur-jelly-jumper:** use black HUD text (green bg) ([312c5cc](https://github.com/gjsify/gjsify/commit/312c5cc8e3dcde45725bacf93f01ac85a2e73011))
* **webgl,excalibur-jelly-jumper:** final allocation fixes ([9a78eaa](https://github.com/gjsify/gjsify/commit/9a78eaaeaf347cf459666bceeafe411192b50947))
* **webgl,webaudio:** eliminate per-frame GLib.Source + defer audio pipeline teardown ([d66a44f](https://github.com/gjsify/gjsify/commit/d66a44f8be4a6adbdd4a4577fa17fe2d695c375d))
* **webgl:** eliminate Vala GLenum[] conversion loops + cache VariantType ([0ee028a](https://github.com/gjsify/gjsify/commit/0ee028ad8e57a47e17af4f295f7f7a2b239dd02f))

## Unreleased

### feat(integration/ts-for-gir) — Phase 4b: non-interactive `@ts-for-gir/cli` on GJS (2026-04-30)

The same `@ts-for-gir/cli@4.0.0-rc.6` bundle that Phase 4a proved on Node now also runs on GJS. `dist/cli.gjs.mjs` is built via [`tests/integration/ts-for-gir/scripts/build-cli-gjs.mjs`](tests/integration/ts-for-gir/scripts/build-cli-gjs.mjs) — a small `gjsify build` wrapper that injects `--alias` paths from a per-test stub directory ([`tests/integration/ts-for-gir/src/stubs/`](tests/integration/ts-for-gir/src/stubs/)) for the bundle-hostile deps:

- `typedoc` and `@ts-for-gir/typedoc-theme` (read their own `package.json` via `import.meta.url`-relative path; bundle escapes the package and crashes)
- `prettier` (same `import.meta.url` issue + plugin auto-loader walks the filesystem)
- `@inquirer/prompts` and `inquirer` (hundreds of named exports; alias-resistant)
- `@ts-for-gir/generator-html-doc` and `@ts-for-gir/generator-json` (cut the dep tree at the highest level — these are the only two consumers of typedoc/prettier in the CLI's call graph)

The stubs export the symbols that `@ts-for-gir/cli`'s `commands/` and `generation-handler.ts` import, so the bundle compiles and every command that does not execute the stubbed code at runtime works (`--version`, `--help`, `list`, `copy`, `analyze`). Commands that DO need the stubbed code (`doc`, `json`, the interactive prompts inside `create`) throw a clear "stubbed on GJS" error at the call site.

`cli.spec.ts` now spawns BOTH bundles from the Node test runtime: `node dist/cli.node.mjs <args>` and `gjs -m dist/cli.gjs.mjs <args>`, with `LD_LIBRARY_PATH`/`GI_TYPELIB_PATH` pointing at the `@gjsify/*` prebuild dirs. Same 5 assertions per bundle = **10 CLI tests, all green on Node**. Skipped when the spec runs on the GJS test runtime — `@gjsify/child_process` (Gio.Subprocess) currently hangs the parent's main loop when it spawns another `gjs`, tracked as Phase 5 in STATUS.md. Spawning from Node still validates the GJS bundle end-to-end.

**Total ts-for-gir suite: Node 229/229, GJS 169/169.**

**Three runtime fixes in [`tests/integration/ts-for-gir/src/cli.entry.ts`](tests/integration/ts-for-gir/src/cli.entry.ts) that make the GJS bundle terminate cleanly:**

1. **GLib MainLoop bootstrap.** The CLI's `list`/`generate` handlers do async `fs/promises` I/O. On GJS that needs the GLib main context to dispatch — without it the process exits before the handler ever runs. We start an idempotent `GLib.MainLoop().runAsync()` inline (4 lines, accessing `imports.gi.GLib` directly) rather than importing `ensureMainLoop` from `@gjsify/utils`, because `@gjsify/utils`'s other source files have non-type imports of `@girs/glib-2.0` / `@girs/gio-2.0`, which become runtime `import "@girs/*"` statements in the Node bundle and crash Node's ESM loader on the first `gi://` URL.

2. **yargs `.exitProcess(false)`.** Without it, yargs's internal `process.exit(0)` for `--version` / `--help` runs synchronously inside `parseAsync`. On GJS that triggers `imports.system.exit` while the GLib MainLoop is still parked in `runAsync()`, deadlocking the process for the entire CLI test timeout. With `exitProcess(false)`, parseAsync resolves cleanly and our own `shutdown()` runs.

3. **`GLib.idle_add` + `imports.system.exit` shutdown.** Calling `imports.system.exit` from inside a promise-microtask continuation (which is where the `await yargs(…).parseAsync()` resolution lands) leaves the process parked even after the loop is quit. Scheduling the exit on a `GLib.idle_add` callback hands control back to the loop first, so the syscall fires from a fresh main-loop iteration.

Build script + entry file diffs are scoped to the integration test — no `@gjsify/*` package code changes in this PR. The corner cases above all live in upstream packages (yargs, typedoc, GLib's loop semantics) and are best worked around at the consumer level for now.

### feat(integration/ts-for-gir) — Phase 4a: non-interactive `@ts-for-gir/cli` on Node (2026-04-30)

Bundled `@ts-for-gir/cli@4.0.0-rc.6` runs end-to-end on Node via `gjsify build` + a small in-project `cli.entry.ts` shim that mirrors the upstream `start.ts` wiring (the published package's `exports` map only exposes `.`, not the full source tree). New `cli.spec.ts` (5 tests) spawns the bundled CLI as a subprocess and asserts on stdout/stderr:

- `--version` → `"4.0.0-rc.6"` (proves the new `gjsify build --define` flag injects the `__TS_FOR_GIR_VERSION__` build-time constant)
- `--help` → renders the full command tree (analyze, create, generate, json, list, copy, doc) — proves yargs's command registration loads cleanly
- yargs `.strict()` rejects unknown commands
- `list --help` → renders per-command flags (proves cosmiconfig + the option builder load)
- `list -g <dir>` → walks our local Vala-generated GIRs via `glob` and renders them through colorette

**Total ts-for-gir suite: Node 199/199, GJS 169/169 + 1 ignored (the gated CLI suite — see STATUS.md Phase 4b).**

**Three root-cause fixes landed in the same PR — surfaced by the bundling and runtime errors:**

1. **`@gjsify/util` gains `styleText` and `stripVTControlCharacters`** ([packages/node/util/src/index.ts](packages/node/util/src/index.ts)). Required by every `@inquirer/*` package — `@inquirer/core/lib/screen-manager.js` calls `stripVTControlCharacters`, and `theme.js`/`Separator.js` import `styleText`. Implementations follow Node's spec from `refs/node/lib/util.js:167` (styleText) and `refs/node/lib/internal/util/inspect.js:3036` (stripVTControlCharacters), reusing our existing `inspect.colors` map for ANSI code lookup. 12 new tests in `extended.spec.ts` (258 total, all green on Node + GJS).

2. **Per-source-file `__filename`/`__dirname` injection in the Node app target** ([packages/infra/esbuild-plugin-gjsify/src/app/node.ts](packages/infra/esbuild-plugin-gjsify/src/app/node.ts)). esbuild does not auto-shim CJS-only globals when emitting ESM output. Bundled `typescript` (`isFileSystemCaseSensitive` calls `swapCase(__filename)` for case-sensitive-FS detection) crashes with `ReferenceError: __filename is not defined`. Mirrors the existing GJS target hook: any `node_modules/*.{js,cjs}` file referencing these names gets a per-file `var` preamble with the source-file path. A top-of-bundle banner was attempted first but collided with source files that declare these names themselves (e.g. `@ts-for-gir/lib/src/utils/path.ts`).

3. **Three new pass-through flags on `gjsify build`: `--define`, `--external`, `--alias`** ([packages/infra/cli/src/commands/build.ts](packages/infra/cli/src/commands/build.ts), [packages/infra/cli/src/config.ts](packages/infra/cli/src/config.ts), [packages/infra/cli/src/actions/build.ts](packages/infra/cli/src/actions/build.ts), [packages/infra/cli/src/types/](packages/infra/cli/src/types/)). esbuild already supports all three natively; the CLI just needed surface area.
   - `--external <pkg>[,<pkg>...]` (repeatable): marks modules as runtime imports. The plugin merges user externals with the platform's built-in list (`EXTERNALS_NODE`, `gi://*`, `cairo`, etc.) so neither overrides the other.
   - `--define KEY=VALUE` (repeatable): substitutes compile-time constants. VALUE is a JS expression — string literals must be JSON-quoted (`--define VERSION='"1.2.3"'`). Required for upstream packages that gate behavior on `typeof __FOO__ !== 'undefined'`.
   - `--alias FROM=TO[,FROM=TO...]` (repeatable): layers user aliases on top of the gjsify built-in alias map.

**Re-bundling `@ts-for-gir/cli` from source needs explicit devDeps for the workspace generators.** `generation-handler.ts` imports `@ts-for-gir/generator-html-doc` and `@ts-for-gir/generator-json` at top level. Neither is listed under `dependencies` — and that is intentional: `@ts-for-gir/cli` publishes a pre-bundled `bin/ts-for-gir` (28k lines of esbuild output, all generators inlined) that end-users run directly, so the generator packages are dev-only for the upstream repo. Our integration test re-bundles `src/start.ts` ourselves to layer in gjsify's GJS-specific transforms, so we declare the generator packages as devDeps in `tests/integration/ts-for-gir/package.json`. Not an upstream bug.

### feat(tests/integration/ts-for-gir) — Phases 2+3: `@ts-for-gir/lib` type system + generator pipeline on GJS (2026-04-29)

Extends the ts-for-gir integration suite with two new spec files: **`lib.spec.ts`** (51 tests, Phase 2) and **`generator.spec.ts`** (18 tests, Phase 3). All 169 tests pass on both Node.js and GJS with 0 skips.

**Phase 2 — `@ts-for-gir/lib` type expression builders.** Tests the entire `TypeExpression` class hierarchy as pure value-objects: `TypeIdentifier`, `ModuleTypeIdentifier` (3-arg constructor `name/moduleName/namespace`), `NativeType`, `OrType`/`BinaryType` (set-semantic `equals()` — order-independent), `TupleType` (positional `equals()`), `FunctionType` (plain-object parameter map), `PromiseType`/`ClosureType` (`unwrap()` returns `this`; inner type at `.type`; `ClosureType.deepUnwrap()` returns inner type), `NullableType`, `ArrayType`, `GenericType`, and all 13 primitive singleton constants (`VoidType`, `BooleanType`, `StringType`, `NumberType`, `AnyType`, `NullType`, `NeverType`, `UnknownType`, `ThisType`, `ObjectType`, `Uint8ArrayType`, `AnyFunctionType`, `BigintOrNumberType`). No GIR pipeline — pure type system validation.

**Phase 3 — `@ts-for-gir/generator-typescript` pipeline.** Tests the full DependencyManager → GirModule.load → GirModule.parse → ModuleGenerator.generateModule chain against a minimal synthetic GIR written to `tmpdir()` at module load time. Key findings: `DependencyManager.get()` requires `girDirectories` to point at the real filesystem (it uses `glob` internally — not an in-memory API); `IntrospectedRecord.members` is an array (`.find()` not `.get()`); `initTransitiveDependencies([])` must be called before `new ModuleGenerator()` because the constructor reads `girModule.transitiveDependencies`; `allowMissingDeps: true` keeps GObject-2.0 as a stub dep so `generateModule()` succeeds. Exercises `glob`, `ejs`, `lodash`, `colorette` — all work on GJS via `@gjsify/*` polyfills.

**New devDeps** in `tests/integration/ts-for-gir/package.json`: `@ts-for-gir/lib@^4.0.0-rc.6`, `@ts-for-gir/generator-typescript@^4.0.0-rc.6`.

### feat(tests/integration/ts-for-gir) — Phase 1: `@gi.ts/parser` integration suite (2026-04-29)

New strategic goal: **`ts-for-gir` runs unmodified on GJS.** ts-for-gir publishes ~10 npm packages (`@gi.ts/parser`, `@ts-for-gir/lib`, `@ts-for-gir/cli`, `@ts-for-gir/generator-*`, `@ts-for-gir/language-server`, `@ts-for-gir/reporter`, `@ts-for-gir/typedoc-theme`); validating them progressively against `@gjsify/*` is the next surface that exercises the full Node.js pillar end-to-end.

**Phase 1 covers `@gi.ts/parser` v4.0.0-rc.6** — the smallest, most isolated package: one runtime dep (`fast-xml-parser`), pure-function API `parser.parseGir(xml: string): GirXML`. **Node: 18/18 green. GJS: 18/18 green, 0 skips.**

Fixtures are gjsify's own Vala-generated GIRs (`Gwebgl-0.1.gir`, `GjsifyWebrtc-0.1.gir`, `GjsifyHttpSoupBridge-1.0.gir`), committed under `tests/integration/ts-for-gir/girs/`. Real-world parser surface — exercises classes (10 total), 300 methods, 40 properties, 26 signals (`<glib:signal>`), an enumeration, the `<constructor>` rename/restore workaround for fast-xml-parser's prototype-pollution guard, and multi-namespace `<include>` deps (Soup, Gst, GstWebRTC, Gio, GObject, GLib).

`refs/ts-for-gir/` git submodule added for porting reference in subsequent phases. The suite is the first to deliberately omit `import '@gjsify/node-globals/register'` — `gjsify build --globals auto` (default) covers everything `fast-xml-parser` and the test code need; explicit `/register` imports in non-package code are now considered an anti-pattern (CLAUDE.md `### Don't patch — implement at the source`).

Out of scope for Phase 1, tracked in STATUS.md Open TODOs: `@ts-for-gir/lib` type-system tests, generator pipeline (Greeter.gir → .d.ts snapshot), CLI tarball end-to-end (blocked on yargs/inquirer/prettier GJS readiness), language-server vitest port (blocked on `typescript` package on GJS).

### fix(@gjsify/unit) — add browserSignalDone for Playwright test completion (2026-04-28)

`@gjsify/unit` now sets `window.__gjsify_test_results` and `document.documentElement.dataset.testsDone = 'true'` when a test run finishes in a browser context. This is required for the Playwright harness (`tests/browser/specs/unit.spec.ts`) to detect that tests have completed and to read pass/fail counts.

**Changes:**
- Added `testErrors` array — collects `{ suite, test, message }` for every failed `it()` call
- Added `currentSuite` tracking — `describe()` sets it on entry and restores on exit so nested describes work correctly
- Added `browserSignalDone()` — called from `run()` after `printResult()`; no-op when `document` is absent (GJS / Node.js)

Without this fix, `dom-elements` and `canvas2d-core` browser test bundles timed out in Playwright even though the tests ran successfully — the harness never received the done signal.

### feat(tests/browser) — promote to yarn workspace, add dom-elements + canvas2d-core (2026-04-28)

`tests/browser/` is now a proper yarn workspace (`@gjsify/tests-browser`) with `@playwright/test` as a dev dependency. This makes `playwright` available to the workspace without requiring a global install.

**New browser test bundles (verified green in Firefox):**
- `packages/dom/dom-elements/dist/test.browser.mjs` — Node tree ops, Element attributes, classList, HTMLElement properties, Text/Comment/DocumentFragment, DOMMatrix, CSSStyleDeclaration, FontFace, FontFaceSet, matchMedia
- `packages/dom/canvas2d-core/dist/test.browser.mjs` — clearRect with active state, save/restore for all context properties, transforms, ImageData (RGBA byte order), text metrics, composite ops, drawImage (3/5/9-arg), path ops

`discover-bundles.mjs` already scanned `packages/dom/` (added in a prior PR). Total: 13 passing browser bundles.

### feat(examples) — SQLite todo store example cross-validated on GJS and Node.js (2026-04-28)

New example `examples/node/cli-sqlite-json-store` (`@gjsify/example-node-cli-sqlite-json-store`) demonstrates `node:sqlite` (`DatabaseSync` + `StatementSync`) running identically on both GJS (via `@gjsify/sqlite` / `gi://Gda`) and Node.js (native).

**Features demonstrated:**
- `prepare().run()` for DDL (CREATE TABLE) and transaction control (BEGIN/COMMIT)
- Named parameter binding (`{ title, priority, done, created_at }`) via bare-name resolution
- `run()` returning `{ lastInsertRowid, changes }` for INSERT/UPDATE/DELETE
- `get()` for single-row queries (SELECT BY ID, COUNT)
- `all()` for multi-row queries with ORDER BY
- Prepared statement reuse across multiple calls
- Transaction-wrapped bulk insert
- File-based database in a temp directory (cleaned up after the demo)

Validates that the `@gjsify/sqlite` implementation handles the full CRUD cycle correctly on GJS: CREATE TABLE, INSERT, SELECT, UPDATE, DELETE, BEGIN/COMMIT all work. No core issues found — output is bit-identical between GJS and Node.js runs.

### feat(tests/browser) — browser tests for dom-elements and canvas2d-core (2026-04-28)

Extends the Playwright browser test infrastructure (from PR #42) to cover DOM packages:

- **`packages/dom/dom-elements/src/test.browser.mts`** (new): Browser tests using native browser globals covering Node tree operations, Element attributes, classList/DOMTokenList, HTMLElement properties (title, lang, hidden, tabIndex, draggable, contentEditable, on* handlers), Text/Comment/DocumentFragment, DOMMatrix (identity, 6/16-element init, multiply, inverse, translate, scale), CSSStyleDeclaration via `element.style`, FontFace/FontFaceSet, `window.matchMedia`.
- **`packages/dom/canvas2d-core/src/test.browser.mts`** (new): Browser tests using `document.createElement('canvas').getContext('2d')` covering clearRect (with transform/clip/globalAlpha/negative-width), save/restore state round-trips (fillStyle, strokeStyle, globalAlpha, globalCompositeOperation, lineWidth, lineCap, lineJoin, miterLimit, lineDash, font/textAlign/textBaseline, imageSmoothingEnabled), transforms (translate, scale, transform, setTransform, getTransform, DOMMatrix.multiply round-trip), ImageData (createImageData, getImageData, putImageData), text (measureText, fillText, strokeText), all 26 composite operations, drawImage (3/5/9-arg canvas-to-canvas), path operations (fillRect, arc, clip).
- **`tests/browser/scripts/discover-bundles.mjs`**: Extended to scan `packages/dom/*/dist/` in addition to `packages/web/*/dist/`. Total discovered bundles: 13 (11 web + 2 DOM).
- `build:test:browser` script added to both `packages/dom/dom-elements/package.json` and `packages/dom/canvas2d-core/package.json`.

GTK-only packages (`canvas2d` with Canvas2DBridge, `event-bridge` with attachEventControllers) are intentionally excluded — they have no browser equivalent.

### chore — extend native prebuilds to linux-ppc64, linux-s390x, linux-riscv64 (2026-04-28)

Added QEMU-based CI builds for three additional Linux architectures in `.github/workflows/prebuilds.yml`.

**New `build-prebuilds-qemu` job** uses `uraimo/run-on-arch-action@v2` on `ubuntu-latest` host runners with QEMU binary-format emulation:

- **`linux-ppc64`** (IBM POWER9/10) — `base_image: fedora:43` (official ppc64le manifest entry), same dnf packages as the native Fedora job. Targets Raptor Computing Talos II / Blackbird workstations running GNOME on Fedora.
- **`linux-s390x`** (IBM Z mainframes) — `base_image: fedora:43` (official s390x manifest entry), same dnf packages. Enterprise Linux server deployments.
- **`linux-riscv64`** (StarFive VisionFive 2, Milk-V Pioneer, SiFive HiFive, …) — `base_image: ubuntu:24.04` (fedora:43 has no riscv64 image), apt-get package equivalents. Auto-detected via `command -v dnf` in the `install:` block.

**Architecture → prebuilds dir** mapping relies on Node.js `process.arch` which already returns `'ppc64'`, `'s390x'`, `'riscv64'` for these platforms — the existing `nodeArchToLinuxArch()` in `packages/infra/cli/src/utils/detect-native-packages.ts` passes them through as-is, so no CLI changes were needed.

**`commit-prebuilds` job** updated to `needs: [build-prebuilds, build-prebuilds-qemu]` and downloads artifacts for all five architectures per package (15 download steps total across webgl, webrtc-native, http-soup-bridge).

Prebuilt `.so` + `.typelib` directories added: `prebuilds/linux-{ppc64,s390x,riscv64}/` in `@gjsify/webgl`, `@gjsify/webrtc-native`, `@gjsify/http-soup-bridge`. READMEs and STATUS.md updated to reflect the expanded platform matrix.

### chore — repo stability sweep (2026-04-28)

Three small fixes around the recent `@gjsify/http-soup-bridge` landing:

**CI: prebuilds workflow path correction.** `.github/workflows/prebuilds.yml` still pointed at `packages/dom/webgl`, but that package was moved to `packages/framework/webgl` in `319762fb1`. Every prebuild run on `main` was failing in the first `meson setup` step with `chdir to cwd packages/dom/webgl: no such file or directory`. Updated all path references (trigger paths, working-directory, artifact paths, commit-prebuilds add list) to `packages/framework/webgl`. The other two prebuild targets (`packages/web/webrtc-native`, `packages/node/http-soup-bridge`) were unaffected.

**Examples: `gjs -m` → `gjsify run` across all `examples/node/*`.** Once `@gjsify/http` started depending on the `GjsifyHttpSoupBridge-1.0` typelib, every example using `node:http` / Hono / Express / Koa / SSE / WebSocket needed `LD_LIBRARY_PATH` + `GI_TYPELIB_PATH` set to the prebuilds directory. `gjsify run` does that automatically; raw `gjs -m` does not. Migrated `start:gjs` (and `test:gjs` where present) in all 23 `examples/node/*` packages — both the directly-affected HTTP-stack examples (`gtk-http-dashboard`, `net-hono-rest`, `net-express-hello`, `net-koa-blog`, `net-sse-chat`, `net-ws-chat`, `net-static-file-server`) and the rest of the `cli-*` examples for consistency. Dashboard verified end-to-end: GTK window opens, HTTP server accepts requests, JSON responses round-trip.

**Tests: granular `/register` subpath migration.** `@gjsify/node-globals/register` is now genuinely opt-in (Step 3 of the split tracked in STATUS.md). The 9 per-package test entries in `packages/{node,web}/*/src/test.mts` and the 2 Autobahn driver bundles now import only the granular subpaths each test actually needs (`register/process` is universal for `@gjsify/unit`'s `process.env` / `process.exit` reads; the rest is per-package — `register/buffer`, `register/timers`, `register/url`, `register/microtask`, `register/structured-clone`). The two meta-package self-tests (`@gjsify/node-globals`, `@gjsify/web-globals`) keep the catch-all because they verify the entire register surface by design. Examples and integration suites (webtorrent, socket.io, streamx, mcp-typescript-sdk, mcp-inspector-cli) keep the catch-all — they're the legitimate "give me the full Node runtime surface" consumers (real third-party libraries pull in everything). Repo-wide `yarn check` clean; all migrated package tests green on Node + GJS.

### feat — `@gjsify/http-soup-bridge`: native Vala bridge for libsoup HTTP server (2026-04-27)

New native package + integration into `@gjsify/http`. Closes both libsoup-related entries from STATUS.md "Upstream GJS Patch Candidates" by moving the entire `Soup.Server` interaction into Vala-emitted C and exposing JS only through plain GObject classes. Same pattern as `@gjsify/webrtc-native` — see PR #44 for full context.

**The bridge package** (`packages/node/http-soup-bridge/`):

- `Server` (`src/vala/server.vala`) — wraps `Soup.Server` + `add_handler` + `add_websocket_handler`. Emits `request_received(req, res)` / `upgrade(req, iostream, head)` / `error_occurred(msg)` signals to JS.
- `Request` (`src/vala/request.vala`) — read-side snapshot. `method` / `url` / `header_pairs` / `remote_address` / `remote_port` are properties; `get_body()` is a method (a GIR-marshalled `uint8[]` property loses bytes through the round-trip).
- `Response` (`src/vala/response.vala`) — write side. Owns `SoupServerMessage` privately; all pause/unpause bookkeeping (the seven concerns previously in `SoupMessageLifecycle.ts`) move into Vala.
- `peer-close-watch.vala` — `g_socket_create_source(IN | HUP | ERR)` + non-blocking `g_socket_receive_message(MSG_PEEK)` for long-poll TCP-close detection. The capability we couldn't reach from JS (`Gio.Socket.receive_message` not introspectable, Linux POLLRDHUP not exposed in `IOCondition`).
- All cross-thread emissions hop through `GLib.Idle.add()` to the default main context before re-emission.

**`@gjsify/http` integration** (`packages/node/http/src/server.ts`):

- `Server` constructs a `BridgeServer`, wires `request-received` / `upgrade` / `error-occurred` signals into Node-style `'request'` / `'upgrade'` / `'error'` events.
- `ServerResponse` is a thin `Writable` over `BridgeResponse` — `set_header` / `write_head` / `write_chunk` / `end` delegate.
- `IncomingMessage` reads request fields from the bridge `Request` snapshot.
- `ServerRequestSocket` constructed from plain `string` / `uint` values rather than holding a `SoupServerMessage`.
- `soup-message-lifecycle.ts` deleted — its concerns are intrinsic to the bridge.
- All seven existing `@gjsify/http` test specs pass unchanged; 1038 GJS / 1034 Node tests green.

**Build / CI:**

- `meson` produces `libgjsifyhttpsoupbridge.so` + `GjsifyHttpSoupBridge-1.0.{gir,typelib}`.
- TS types bootstrapped locally via `ts-for-gir generate` until `@girs/gjsifyhttpsoupbridge-1.0` is published to npm.
- `.github/workflows/prebuilds.yml` extended with a `libsoup3-devel` install + matrix entry that produces `prebuilds/linux-{x86_64,aarch64}/` and auto-commits them on `main` pushes.

**Verification (local, Fedora 43, GJS 1.86 / libsoup 3.6.6):**

| Scenario | Pre-bridge | This change |
|---|---|---|
| Single Node.js fetch with chunked SSE → wait 30 s | 💥 SIGSEGV at ~13 s | ✅ alive |
| 50 sequential Node.js SSE fetches against the bridge alone | 💥 crash at ~5 | ✅ all 200, alive |
| `mcp-inspector-cli` sequential-call cap | 3 | 4 |
| Total tests on this branch | 1742 | 1788 |

**Known residual issue:** the example MCP server (which pulls MCP SDK + @hono/node-server + web-streams polyfill) still hits a deferred-GC SIGSEGV ~13 s after a Node-fetch SSE request. The crash signature (`BoxedBase::finalize → g_source_unref`) is the same shape as the original libsoup-side race, but the offending wrapper is no longer in our HTTP-server path — it's allocated by some Boxed-creating path in the MCP / Hono / streams stack. Tracked under STATUS.md "Open issues"; the fix needs a coredump with debug symbols to identify which Boxed type.



### refactor — `@gjsify/http`: consolidate Soup.ServerMessage lifecycle + fix MCP server crashes (2026-04-26)

Resolves the SIGSEGV that prevented MCP servers (and other Hono-based apps) from running on GJS. The fix landed across multiple files; the centerpiece is a new `SoupMessageLifecycle` helper that consolidates everything related to one in-flight Soup message: GC guard, `'finished'`/`'disconnected'` signal handling (translated to Node-style req/res `'close'`/`'aborted'` events), and `'wrote-chunk'`-driven re-unpause tracking via a unpause-ticket pattern (`consumeUnpauseTicket()`).

**Bug fixes** — these were the actual SIGSEGV causes:

- **GC use-after-free on `Soup.ServerMessage`**: After Hono drops its reference to `res`, SpiderMonkey GC was free to collect the JS wrapper around `_soupMsg` while Soup's IO was still touching it. The lifecycle helper now pins the GObject in a module-level `_activeMessages` Set until Soup signals `'finished'`.
- **Missing re-unpause on multi-chunk responses**: libsoup HTTP1 IO calls `soup_server_message_pause()` between chunks; without a matching `unpause()`, subsequent appended chunks (and the chunked terminator) were never sent. The `'wrote-chunk'` signal fires synchronously inside Soup's IO right before the auto-pause, so by the time JS resumes the unpause is safe and necessary.
- **Soup signals not propagated to req/res**: Frameworks that listen for `req.on('close')` (MCP SDK, engine.io, anything streaming) had no cleanup trigger. Now `'disconnected'` emits `'aborted'`+`'close'` on req and `'close'` on res; `'finished'` emits `'close'` on req for the normal completion path.
- **Async handler rejections swallowed by GLib's callback layer**: User-code `async (req, res) => { … }` rejections were lost as g_warnings — now caught and logged with a 500 fallback in `Server._handleRequest`.
- **`req.socket` was a plain object missing `destroySoon`**: Hono calls `socket.destroySoon()` after every response. New `ServerRequestSocket extends Duplex` provides a real `net.Socket` duck-type with `destroySoon`/`pause`/`resume`/`setNoDelay`/etc. — `pause/resume` now actually forward to the underlying Soup message so backpressure works.
- **`@gjsify/net.Socket.destroySoon()` was missing entirely**: added with a matching unit test.
- **`@gjsify/fetch` body wrapper raised inside the nextTick queue**: `controller.close()` would throw if the consumer cancelled; now guarded with a `closed` flag and try/catch (eliminates the constant `gjsify-nextTick-WARNING` spam during MCP responses).

**Refactor:**

- All defensive try/catch wrappers around Soup API calls in `_write`/`_final`/`_sendBatchResponse` removed — libsoup's GI-bound C API does not raise JS exceptions, so they were dead code. The async-handler catch in `_handleRequest` stays.
- `ServerResponse` is now thin: drops `_soupNeedsUnpause`/`_soupWroteChunkId`/etc., delegates everything via `_attachLifecycle()`.

**Examples:**

- `examples/node/net-mcp-server`: holds `McpServer` instances per session in a parallel `mcpServers` Map (was locally scoped inside the request handler — could be GC'd between requests, pulling down its underlying GLib sources). Resource URI changed from `info://server` to `info://server/meta` to work around a separate GJS URL-parsing quirk that adds a trailing slash to authority-only URIs.

**Tests:**

- New `tests/integration/mcp-typescript-sdk/streamable-http.spec.ts` cases: multiple sequential tool calls on a shared client, multiple per-session transports following the real-world pattern, raw HTTP fetch loop without MCP, forced `imports.system.gc()` between tool calls, inspector-style mixed workload.
- New `tests/integration/mcp-inspector-cli/` suite — drives the official `@modelcontextprotocol/inspector` CLI as a subprocess against both GJS and Node builds of the example MCP server. Catches regressions in the exact wire shape that produced the original crash. 14 tests (7 × 2 server targets).

**Known limitations (tracked in STATUS.md "Upstream GJS Patch Candidates"):**

1. *Long-poll/SSE peer-close not detected on paused messages.* libsoup stops polling the input stream while a server message is paused, so `'disconnected'` never fires for long-poll/SSE clients that hang up. `SoupMessageLifecycle` opts GET requests *out* of the GC guard so SpiderMonkey GC can eventually collect them, but the libsoup-side state accumulation still crashes the GJS process after ~5 hung long-polls. The inspector-CLI sequential-call test stays capped at 3 iterations.

2. *GJS Boxed-Source GC race for chunked responses to non-GJS HTTP clients.* A single `fetch()` from a Node.js process to our HTTP server with a chunked `text/event-stream` response causes a SIGSEGV ~10–13 s later (`gjs exited with code null`, no JS traceback). Backtrace: `BoxedBase::finalize → g_source_unref → assertion 'old_ref > 0' failed`. A libsoup-internal `GLib.Source` is exposed to JS without proper transfer ownership; GLib frees it when Soup completes the response, then GJS's deferred-GC heuristic (`g_timeout_add_seconds(10, …)`, `refs/gjs/gjs/context.cpp:873-906`) fires the JS finalizer which double-unrefs. **In-process MCP `client.callTool` does NOT trigger this** — the CI suite passes — but external HTTP clients (MCP Inspector subprocess, browser EventSource, raw `node -e 'fetch(…)'`) do. We attempted but rejected: eager `imports.system.gc()` after `'finished'` (corrupts shared keep-alive state when a sibling long-poll exists), idle-only GC gated on `_inFlightCount === 0` (paused long-polls keep count > 0 forever), forced `Connection: close` (no help), `condition_check(HUP|ERR)` watchdog (Linux POLLHUP only fires on bilateral close, not the typical client-side half-close), `Gio.Socket.receive_message(MSG_PEEK)` non-destructive probe (not introspectable from JS — `(out caller-allocates)` for `gint8[]` buffers is not bound). A real fix requires either a GJS GIR-bindings audit to identify and fix the offending transfer-mode annotation, or a libsoup patch moving chunked-write internals away from JS-visible Sources.

1742+ tests stay green on Node and GJS; new `mcp-inspector-cli` suite adds 14.

### feat — `@gjsify/http2`: compat layer + session API via Soup 3.0 (2026-04-25)

`http2.createServer()`, `http2.createSecureServer()`, `http2.connect()` are now functional instead of throwing.

**Server (Soup.Server-backed):**
- `createServer(handler)` → `Http2Server` — Soup.Server on plain TCP (HTTP/1.1, no h2c)
- `createSecureServer({ cert, key }, handler)` → `Http2SecureServer` — Soup.Server with TLS; auto-advertises `h2` via ALPN, falls back to HTTP/1.1
- Server emits both `'request'` (compat API: `(Http2ServerRequest, Http2ServerResponse)`) and `'stream'` (session API: `(ServerHttp2Stream, headers)`) on each request
- `Http2ServerRequest` extends `Readable` — method, url, headers, raw body stream
- `Http2ServerResponse` extends `Writable` — writeHead, setHeader, write, end, respond (session alias)
- `ServerHttp2Stream` — facade over response, exposes `respond(headers)`, `write()`, `end()`

**Client (Soup.Session-backed):**
- `connect(authority, options)` → `ClientHttp2Session` — wraps Soup.Session; over HTTPS auto-upgrades to HTTP/2 via ALPN
- `session.request(headers, { endStream })` → `ClientHttp2Stream` — Duplex: writable = request body, readable = response body; emits `'response'` event with response headers

**Phase 1 limitations** (documented in source): no `pushStream`, no stream IDs, no explicit flow control/priority (all Soup-internal). `createServer()` serves HTTP/1.1 only (Soup has no h2c support). Phase 2 requires a Vala/nghttp2 native extension.

**Tests:** 128 total (102 Node + 26 new GJS integration tests). Codebase refactored into `src/protocol.ts` (constants), `src/server.ts`, `src/client-session.ts`, `src/index.ts`.

### feat — `createWebSocketStream` + socket.io WebSocket transport (2026-04-24)

**`createWebSocketStream(ws, options)`** — wraps any `ws`-shaped WebSocket (client or server-side) in a Node.js `Duplex` stream. Text frames are converted to `Buffer` before being pushed into the readable side (non-objectMode). Backpressure: `ws.pause()` / `ws.resume()` are called if present. `_final` sends a close frame and waits for the corresponding 'close' event before completing. `_destroy` calls `ws.terminate()` for immediate teardown. 3 new GJS tests (echo via pipe, EOF on client close, write → message). 43 GJS / 19 Node tests total.

**socket.io examples** — `cli-socket.io-chat-server` and `cli-socket.io-pingpong` both remove the `transports: ['polling']` override. Engine.io now uses our `{ noServer: true }` + `handleUpgrade()` to upgrade browser connections to WebSocket automatically (confirmed via DevTools: 101 Switching Protocols visible). Added READMEs for both examples and for `net-ws-server`. Bug fix: removed spurious double `'connection'` emission from `_completeUpgrade` (caller's callback is now the sole emitter).

### feat — WebSocket server Phase 3: `{ noServer: true }` + `handleUpgrade()` + `'headers'` event (2026-04-24)

Completes the standard engine.io / socket.io integration pattern for `@gjsify/ws` `WebSocketServer`.

**`{ noServer: true }`** — Constructor no longer throws. In this mode no `Soup.Server` is created and no port is bound. The caller owns an `http.Server`, listens on the `'upgrade'` event, and passes the raw request + socket + head to `handleUpgrade()`. Mutually exclusive with `port` and `server`.

**`handleUpgrade(req, socket, head, cb)`** — Full manual upgrade implementation:
1. Validates request headers (method=GET, Upgrade=websocket, Sec-WebSocket-Key format, Sec-WebSocket-Version 13/8, path via `shouldHandle`). Rejects with HTTP 4xx via `socket.write` + `socket.destroy` on any failure.
2. Runs `verifyClient` (sync or async) if configured — 401 abort on rejection.
3. Computes `Sec-WebSocket-Accept` via SHA-1 + GUID (`@gjsify/crypto` `createHash('sha1')`).
4. Runs `handleProtocols` if configured — appends `Sec-WebSocket-Protocol` to response headers. **Unlike the Soup path, the client now sees the correct subprotocol** because we write the 101 ourselves (resolves the Phase 2 client-visible protocol limitation).
5. Emits `'headers'` (mutable `string[]`) — listeners may push additional response headers (e.g. `Set-Cookie`).
6. Writes the 101 response via `socket.write()`.
7. Calls `socket._releaseIOStream()` to hand the raw `Gio.IOStream` to `Soup.WebsocketConnection['new']()`. Wraps in `ServerSideWebSocket`, tracks in `clients`, emits `'connection'`, calls `cb(ws, req)`.

**`'headers'` event** — Mutable `string[]` emitted before every 101 write in the `handleUpgrade` path. Enables engine.io / socket.io to inject `Set-Cookie` and other headers.

**`_attachOutputOnly` in `@gjsify/net` `Socket`** — New internal method used by `http.Server._handleRequest` in the upgrade path instead of `_setupFromIOStream`. Sets up write capability and address info from the `Gio.IOStream` but does NOT start the async read loop, eliminating a fatal race where both the `NetSocket` read loop and `Soup.WebsocketConnection` would consume the same input stream.

**`_releaseIOStream` in `@gjsify/net` `Socket`** — Transfers `Gio.IOStream` ownership to the caller. The socket's references are nulled so it does not close the stream when garbage-collected or destroyed.

5 new tests added to `packages/node/ws/src/index.spec.ts` (updated stale "noServer throws" → "noServer accepted" + "noServer+port throws"). 4 new tests in `websocket-server.spec.ts` (GJS-only): echo via handleUpgrade, verifyClient reject via handleUpgrade, handleProtocols client-visible via handleUpgrade, 'headers' event. **40 GJS tests total** (up from 35), 18 Node tests unchanged.

### feat — WebSocket server hooks Phase 2: `verifyClient`, `handleProtocols`, `{ server }` (2026-04-24)

Adds server-side access control, subprotocol negotiation, and shared-port mode to `@gjsify/ws` `WebSocketServer`.

**`verifyClient`** — HTTP-level access control before the WebSocket upgrade is accepted. Implemented via Soup's handler ordering: `add_handler` fires before `add_websocket_handler` for the same path; setting a status code in the HTTP handler prevents the websocket handler from firing. Supports both the synchronous `(info) => boolean` form and the asynchronous `(info, callback)` form (detected by `fn.length >= 2`). Async uses `msg.pause()` / `msg.unpause()` so the GLib event loop continues running during the callback. The `info` object is fully populated: `origin`, `secure`, `req.method`, `req.url`, `req.headers`, `req.socket.remoteAddress`.

**`handleProtocols`** — Subprotocol selection after a connection is accepted. The callback receives a `Set<string>` of client-offered protocols and the request object; the return value is stored on the server-side `ws.protocol`. **Known limitation (Phase 3):** Soup commits the 101 response before `add_websocket_handler` fires, so the `Sec-WebSocket-Protocol` response header is already sent — client-visible protocol selection requires manual handshake via `handleUpgrade()` (out of scope for Phase 2).

**`{ server: existingHttpServer }`** — Attach a `WebSocketServer` to an existing `@gjsify/http` `Server` instead of creating its own `Soup.Server`. The http.Server exposes a new `get soupServer(): Soup.Server | null` getter that `WebSocketServer` uses to register `add_websocket_handler` (+ optionally `add_handler` for `verifyClient`) on the shared server. The caller controls `listen()`; `WebSocketServer` emits `'listening'` immediately (synchronous, via `queueMicrotask`).

**`_handleRequest` fix in `@gjsify/http`** — WebSocket upgrade requests that have no `'upgrade'` listener on the http.Server were previously paused and emitted as `'request'`, starving any `add_websocket_handler` registered on the same `Soup.Server`. The fix: return early for all `Connection: upgrade` + `Upgrade: websocket` requests, regardless of listener count. If an `'upgrade'` listener exists, it gets the stolen IOStream as before; otherwise Soup continues to the websocket handler transparently.

12 new tests added to `packages/node/ws/src/websocket-server.spec.ts` (all GJS-only): verifyClient sync reject/accept, verifyClient async reject/accept, verifyClient info fields, handleProtocols subprotocol selection, and `{ server }` shared-port echo. 35 GJS tests total (up from 23), 18 Node tests unchanged.

### feat — WebSocket client options: `headers`, `origin`, `handshakeTimeout` (2026-04-24)

Implements three commonly-used npm `ws` client options in `@gjsify/websocket` and forwards them through `@gjsify/ws`.

**`options.headers`** — Extra HTTP headers sent with the WebSocket upgrade request (e.g. `Cookie`, `Authorization`). Wired into `Soup.Message.get_request_headers()` before `websocket_connect_async` using `replace()` for single values and `append()` for array values.

**`options.origin`** — Sets the HTTP `Origin` header by passing the value as the second argument to `websocket_connect_async` (was hardcoded `null`).

**`options.handshakeTimeout`** — Aborts the opening handshake after N milliseconds. Implemented via `Gio.Cancellable`: a `setTimeout` fires after the deadline, sets a `_handshakeTimedOut` flag and calls `cancellable.cancel()`; in the async callback, the catch block checks the flag and emits an error with message `"Opening handshake has timed out"` (matching npm `ws` behavior exactly). The error event carries both `.error` (an `Error` instance) and `.message` so the `@gjsify/ws` wrapper surfaces a typed `Error` to its `EventEmitter` listeners.

Error events from connection failures now carry `.error` and `.message` properties so wrapper layers can extract a typed `Error` regardless of the failure mode.

3 new tests added to `packages/web/websocket/src/index.spec.ts` — headers, origin, and handshakeTimeout all verified end-to-end against real Soup.Server / Gio.SocketService listeners. 31 tests total, all passing.

### feat — Autobahn 9.* performance suite enabled (2026-04-24)

Removes the `9.*` exclusion from `tests/integration/autobahn/config/fuzzingserver.json`, completing the full RFC 6455 test matrix. The performance suite covers large-payload throughput: single frames up to 16 MB (9.1.*/9.2.*), fragmented large messages (9.3.*/9.4.*), high-frequency messaging up to 1 M messages × 2 KB (9.5.*/9.6.*), sleep/send timing (9.7.*), and slow-consumer scenarios (9.8.*). Approximately 46 additional cases per agent; expect a full run to take 30–90 min locally.

Driver case-timeout raised from 60 s → **480 s** to match Autobahn's own server-side ceiling. The previous 60 s was calibrated for the deflate cases (12.*); the 9.5.* throughput cases at maximum scale may legitimately need several minutes on the GLib event loop. No code changes to `@gjsify/websocket` or `@gjsify/ws` — pure test-coverage expansion.

Root-cause fix landed alongside: `Soup.WebsocketConnection` has a built-in default limit of 128 KB per incoming frame — any frame larger causes Soup to silently drop the connection. All 28 initially-FAILED 9.* cases (frames ≥ 256 KB) were caused by this limit. Fix: set `max_incoming_payload_size = 100 MB` immediately after `websocket_connect_finish()`, matching the npm `ws` package's default `maxPayload`. All 54 Autobahn 9.* cases now pass: **510 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** over 517 total cases per agent.

### feat — `@gjsify/websocket` permessage-deflate + Autobahn baseline expansion (2026-04-23)

Lands every remaining baseline-visible follow-up from PR #30 (Autobahn pillar) in one PR. Both agent drivers now score **456 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** against the full 463-case suite — up from `240 OK` over 247 cases in the initial Autobahn baseline.

**Shipped code changes:**

- **`@gjsify/websocket` negotiates permessage-deflate (RFC 7692).** The Soup docs claim a `WebsocketExtensionManager` ships in every `Soup.Session` by default, but in practice `new Soup.Session()` comes without one — so we never advertised `Sec-WebSocket-Extensions` and Autobahn reported every `12.*` / `13.*` case `UNIMPLEMENTED`. Fix: in the `WebSocket` constructor, explicitly `Session.add_feature_by_type(Soup.WebsocketExtensionManager.$gtype)` followed by `Session.add_feature_by_type(Soup.WebsocketExtensionDeflate.$gtype)`. Adding deflate without the manager triggers a runtime warning (`No feature manager for feature of type 'SoupWebsocketExtensionDeflate'`). Browsers always offer deflate — we match that unconditionally (no opt-out today). **216 previously-UNIMPLEMENTED deflate cases → OK.**
- **`WebSocket.extensions` now reflects the server-accepted extensions** (was hardcoded `''`). After `websocket_connect_finish` succeeds we call `get_extensions()` on the `Soup.WebsocketConnection` and serialize each `Soup.WebsocketExtension` to the `Sec-WebSocket-Extensions` response-header format (e.g. `"permessage-deflate"` or `"permessage-deflate; client_max_window_bits=15"`). The extension spec name isn't exposed on the JS object (class-level C field, not marshaled over GI), so we `instanceof`-check `Soup.WebsocketExtensionDeflate` and fall back to the stripped GType name for any third-party extension. Real W3C spec bug, surfaced by turning on deflate tests.
- **`tests/integration/autobahn/config/fuzzingserver.json` no longer excludes `12.*` / `13.*`.** Performance suite `9.*` remained excluded at this point — enabled in the follow-up PR.
- **Autobahn driver case-timeout bumped 10 s → 60 s.** The largest deflate cases (12.2.10+, 12.3.10+, 12.5.17 — 1000 × 131 072-byte messages, ~128 MB roundtrip) legitimately need 10–30 s; matches Autobahn's own server-side timeout.
- **`tests/integration/autobahn/scripts/run-driver.mjs` watchdog.** `System.exit(0)` from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (see STATUS.md Open TODOs for the isolation status of that bypass). The wrapper tails the log, waits for the `Done.` marker, grants a 3 s grace window, then `SIGKILL`s. Report is on disk before `Done.` is printed, so no data loss. Temporary — removed once the exit-bypass root cause is fixed.
- **Refreshed baselines** in `reports/baseline/gjsify-websocket.json` + `gjsify-ws.json` reflect the 216 new OK cases. Run diff vs. the old baseline is pure improvement (no regressions, no new missings).

**6.4.x documented as upstream libsoup gap.** The 4 NON-STRICT fragmented-text-with-invalid-UTF-8 cases stay NON-STRICT: `Soup.WebsocketConnection` only surfaces the coalesced `message` signal (no `frame`/`fragment` signal over GI), so validation can only run at end-of-message — RFC-correct close code 1007 but "late" by Autobahn's fast-fail definition. Added to STATUS.md "Upstream GJS Patch Candidates" with the proposed libsoup change (per-frame `incoming-fragment` signal or opt-in per-fragment validation mode on `SoupWebsocketConnection`).

### fix — Excalibur Jelly Jumper showcase startup crash (2026-04-21)

**Root cause:** Our `@gjsify/fetch` `XMLHttpRequest` ignored `responseType` and always returned the body as a string. Excalibur sets `responseType = 'arraybuffer'` for audio and `'blob'` for images, then feeds the (string) "arraybuffer" into `AudioContext.decodeAudioData`. Our webaudio decoder wraps the input in a `Uint8Array` and hands it to `Gst.Buffer.new_wrapped`; `new Uint8Array('')` is length 0, which marshals to a `NULL` data pointer and trips the `gst_memory_new_wrapped: assertion 'data != NULL' failed` critical — killing the GJS process before the game loop ran.

**Fix (bundled):**

- **`@gjsify/fetch` `XMLHttpRequest`** (`packages/web/fetch/src/xhr.ts`) now honours the spec: `arraybuffer` → real `ArrayBuffer`, `blob` → `Blob` with the body materialised to a GLib temp file and `_tmpPath` attached, `json` → parsed JSON, `text`/`''`/`document` → decoded text.
- **`URL.createObjectURL` / `URL.revokeObjectURL` are first-class static methods on `@gjsify/url`'s URL class** (`packages/node/url/src/index.ts`). `createObjectURL(blob)` reads `blob._tmpPath` and returns `file://<tmpPath>`; `revokeObjectURL(url)` unlinks the temp file. No more monkey-patching the URL class from `register/xhr.ts` — the API belongs to the package that owns URL.
- **`@gjsify/webaudio` decoder guard** (`packages/web/webaudio/src/gst-decoder.ts`) — reject non-ArrayBuffer / zero-byte input with `DOMException('Unable to decode audio data', 'EncodingError')` before touching GStreamer, so downstream consumers that hand us malformed buffers get a spec-compliant error instead of a process-killing critical.
- **Regression test** in `packages/web/fetch/src/index.spec.ts` — 4 new cases covering `responseType=arraybuffer|blob|text|''`, `_tmpPath` attachment, and the `URL.createObjectURL` → `file://` round-trip (all under `on('Gjs', …)` since Node has no native XHR).

**Review-driven cleanup — "imports over `globalThis`" pass:**

- **New `AGENTS.md` rule "Don't patch — implement at the source".** We own implementations of almost every Web / Node / DOM API surface; when a method is missing, the first question is which of our classes should own it — not where to monkey-patch it. `globalThis` reads in implementation code are now explicitly restricted to register-module writes, existence probes, env-var-like debug flags, GJS bootstrap, and genuinely soft deps.
- **`packages/web/fetch/globals.mjs` removed.** Node natively exposes `fetch`/`Headers`/`Request`/`Response`/`FormData` as globals (Node 18+); re-exporting them through an alias module only added friction. Specs read these off `globalThis`, matching the Node-native pattern. On GJS the same identifiers come from `@gjsify/fetch/register`. The `'fetch': '@gjsify/fetch/globals'` alias in `ALIASES_WEB_FOR_NODE` is gone.
- **`@gjsify/webrtc` DOMException / Blob reads** (`rtc-peer-connection.ts`, `rtc-data-channel.ts`) now import `DOMException` from `@gjsify/dom-exception` and `Blob` from `@gjsify/buffer` instead of reading `(globalThis as any).X`. 8 `DOMException` call sites and the `Blob` instanceof + constructor sites collapse to plain typed code; the `if (DOMExc) new DOMExc(…) else new Error(…)` fallbacks become dead code. `@gjsify/buffer` added as a hard dep of `@gjsify/webrtc`.
- **`URL.createObjectURL` method marker removed** from `packages/infra/esbuild-plugin-gjsify/src/utils/detect-free-globals.ts` — it was needed when `createObjectURL` lived in the XHR register module, but now that it's a static method on the URL class, the free `URL` identifier (already in `GJS_GLOBALS_MAP`) already pulls in the right register path.

### 🧪 Integration tests — streamx on GJS (2026-04-20)

**`tests/integration/streamx/`** — 6 spec files (155 Node + 156 GJS tests) ported from `refs/streamx/test/` plus a new `throughput.spec.ts`. All green on both runtimes.

- **`readable.spec.ts`** — Readable push/pause/resume/from/setEncoding/isDisturbed (24 tests)
- **`writable.spec.ts`** — write/drain/writev/cork/drained-helper (10 tests)
- **`transform.spec.ts`** — Transform teardown + PassThrough pipe (2 tests)
- **`pipeline.spec.ts`** — pipeline/pipelinePromise + error propagation (5 tests)
- **`duplex.spec.ts`** — Duplex open/map/readable/destroy (5 tests)
- **`throughput.spec.ts`** — queueMicrotask injection, 100-chunk no-loss, pipeline byte preservation, Duplex echo, timing (6 tests on GJS)

**Root cause identified for webtorrent-player 0 B/s symptom:** streamx falls back to `process.nextTick` if `queueMicrotask` is not defined globally. On GJS, `process.nextTick` routes through `GLib.idle_add(PRIORITY_HIGH_IDLE)`, which fires much later in the event loop than a true microtask. `queueMicrotask` is now injected via `@gjsify/node-globals/register/microtask` (auto-detected by the build system). The throughput GJS-only test confirms injection works and all pipeline operations complete in < 1 s.

### fix — `@gjsify/web-streams` pipeTo scheduling (2026-04-20)

`packages/web/streams/src/readable-stream.ts` was importing `nextTick as _queueMicrotask` from `@gjsify/utils`. On GJS, `nextTick` routes through `GLib.idle_add`, which requires a running GLib main loop to fire. Test suites using `async/await` without a GTK application loop never drain the GLib idle queue, causing `pipeThrough` and `TextEncoderStream + TextDecoderStream` round-trips to stall. Fixed by importing `queueMicrotask` (always `Promise.resolve().then()`) instead. Fixes 7 CI failures.

### 🧪 Integration tests — socket.io on GJS (2026-04-20)

**`tests/integration/socket.io/`** — 3 test suites ported from socket.io v4 upstream into `@gjsify/unit` style. **Node: 20/20 green. GJS: 20/20 green, 0 skips.**

- **`handshake.spec.ts`** — CORS OPTIONS/GET headers, `allowRequest` accept/reject (4 tests)
- **`socket-middleware.spec.ts`** — `socket.use()` middleware chain, error propagation (2 tests)
- **`socket-timeout.spec.ts`** — `socket.timeout().emit()` ack timeout, `emitWithAck()` with/without ack (4 tests)

Transport: polling only (`transports: ['polling']`). WebSocket transport requires a server-side `ws` shim and is deferred.

### Root-cause fixes uncovered by the socket.io port (bundled)

- **`@gjsify/fetch` POST body never sent** — `Request._send()` in `packages/web/fetch/src/request.ts` never attached the request body to the `Soup.Message`. Added `_rawBodyBuffer` getter to `Body` class (reads directly from `Body[INTERNALS].body` without draining the stream) and call `message.set_request_body_from_bytes(null, new GLib.Bytes(rawBuf))` in `_send()`. Previously, accessing the `.body` getter triggered streaming mode and drained the buffer before `_send()` read it.
- **`IncomingMessage` wrongly emitted `'close'` after body stream ends** — engine.io registers `req.on('close', onClose)` to detect premature TCP disconnection during long-poll. Our `Readable` base was auto-emitting `'close'` after `'end'` (matching `autoDestroy` behavior), which engine.io misinterpreted as a dropped connection, sending a `CLOSE` packet and killing the session. Fix: added `_autoClose()` protected hook to `Readable` (in `packages/node/stream/`) that emits `'close'` by default, and overrode it in `IncomingMessage` (in `packages/node/http/`) to be a no-op — `'close'` now only fires via `destroy()`, matching Node.js HTTP semantics.
- **`EventEmitter.prototype` methods were non-enumerable** — Socket.io v4 builds `Server` → Namespace proxy methods by iterating `Object.keys(EventEmitter.prototype)`. ES class methods are non-enumerable by default, so `Object.keys` returned `[]` and no proxy was created. `io.on('connection', handler)` attached to the Server's own EventEmitter instead of the default namespace, so the `connection` event (fired by `namespace._doConnect`) never reached the handler. Fix: after the class declaration in `packages/node/events/src/event-emitter.ts`, `Object.defineProperty` re-declares all 15 public instance methods as `enumerable: true`, matching Node.js's prototype-assignment style.

### 🧪 Integration tests — webtorrent on GJS (2026-04-20)

New `tests/integration/` pillar that runs curated upstream tests from popular npm packages against `@gjsify/*` implementations — validating the stack end-to-end in a real consumer. **Node: 185/185 green. GJS: 185/185 green, 0 skips.**

- **`tests/integration/webtorrent/`** — 7 test files ported from `refs/webtorrent/test/` into `@gjsify/unit` style: `selections`, `client-destroy`, `client-add`, `rarity-map`, `bitfield`, `file-buffer`, `iterator`. Fixtures (leaves.torrent, alice, numbers, …) copied from the `webtorrent-fixtures` npm dep at build time; parsed locally via `parse-torrent`.
- **New root scripts:** `yarn test:integration`, `yarn test:integration:node`, `yarn test:integration:gjs`. Not part of `yarn test` — opt-in target.
- **Port convention** documented in `AGENTS.md` `## References → Integration Tests` and `tests/integration/README.md`: manual rewrite into `@gjsify/unit` style (no `@gjsify/test-compat` shim until a second test-runner dialect lands).

### Root-cause fixes uncovered by the webtorrent port (bundled into this PR)

Per `AGENTS.md`'s strengthened **Root-cause fixes beat scope discipline** rule — integration gaps get fixed in the PR that surfaced them, not deferred.

- **`@gjsify/fs` now accepts `URL` path arguments** across every public entry point (`readFileSync`, `readFile`, `writeFile`, `stat`, `lstat`, `readdirSync`, `realpathSync`, `symlinkSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `accessSync`, `appendFileSync`, `readlinkSync`, `linkSync`, `truncateSync`, `chmodSync`, `chownSync`, `rmdirSync`, `rmSync`, `mkdirSync`, `promises.*`, `FSWatcher`, `ReadStream`, `FileHandle`, `watch`). New `normalizePath` helper in `packages/node/fs/src/utils.ts`. Closes the "Expected type string for argument 'path'" crash on `new URL('file:///…')` arguments. **494 fs tests green** on both runtimes.
- **ESM builds no longer pull CJS entries through the `require` condition.** `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` previously included `require` in its conditions list even for ESM format. esbuild picks the first matching condition in an exports-map's declared order; packages like `bitfield` that list `"require"` before `"import"` silently routed through the CJS entry, got wrapped by `__toESM(mod, 1)` into `{ default: { __esModule: true, default: X } }`, and threw `is not a constructor` at runtime. Matches Node's own ESM resolution: the `require` condition is never applied in ESM mode.
- **`random-access-file` browser stub aliased to its Node entry.** `packages/infra/resolve-npm/lib/index.mjs` `ALIASES_GENERAL_FOR_GJS` now maps `random-access-file` → `random-access-file/index.js`. The package's `browser` field points at a stub that unconditionally throws "random-access-file is not supported in the browser"; esbuild's `browser` mainField precedence otherwise silently routed to it, silently stalling every `client.seed(Buffer)` call through fs-chunk-store. GJS has a working `fs`, so the real implementation works out of the box.

### AGENTS.md — strengthened root-cause principle

New paragraph **Root-cause fixes beat scope discipline**: integration gaps get fixed in the PR that surfaces them, not deferred. Workarounds + TODOs rot; bundled root-cause fixes keep history coherent. Documented narrow exceptions (non-standard Node internals, upstream-GJS blockers, genuinely cross-cutting rewrites). Long-term goal: `@gjsify/*` wrappers that run arbitrary npm packages **out of the box**.

## [0.1.15](https://github.com/gjsify/gjsify/compare/v0.1.14...v0.1.15) (2026-04-17)

### Bug Fixes

* **ci:** add `git pull --rebase` before prebuild push to prevent race-condition rejection when multiple CI jobs write to `main` concurrently
* **webrtc-native:** ship missing aarch64 prebuilds (`libgjsifywebrtc.so` + `GjsifyWebrtc-0.1.typelib`) — `@gjsify/webrtc` now works on ARM Linux out of the box

## [0.1.14](https://github.com/gjsify/gjsify/compare/v0.1.13...v0.1.14) (2026-04-17)

### 🚀 WebRTC lands on GJS — real-time P2P, right in your GNOME app

This is the release we've been building toward. **`@gjsify/webrtc`** brings the full W3C WebRTC API to GJS, backed by GStreamer's battle-tested `webrtcbin` pipeline. For the first time, you can open peer connections, exchange data, stream audio/video, and seed torrents — all from a native GNOME application written in TypeScript. No browser required.

#### What's included

**Complete W3C surface** — `RTCPeerConnection`, `RTCDataChannel`, `RTCRtpSender/Receiver/Transceiver`, `MediaStream`, `MediaStreamTrack`, `RTCSessionDescription`, `RTCIceCandidate`, `RTCCertificate`, `RTCDTMFSender`, `RTCStatsReport` and all their events. The API is spec-compliant: ICE trickle, offer/answer state machine, `negotiationneeded`, rollback — it all works.

**GStreamer media pipeline** — `getUserMedia({ audio: true, video: true })` hooks into real hardware via PipeWire → PulseAudio → GStreamer fallback chain. `addTrack()` builds a full encoder chain (VP8/Opus → RTP payloaders → webrtcbin sink pads) automatically. Incoming tracks fire the `track` event and transition from muted to unmuted when media flows.

**Cross-pipeline architecture** — the `VideoBridge` (GTK `Gtk.Picture` + `gtk4paintablesink`) and the WebRTC sender can share the same camera source safely via an automatic `tee` branch — no "pipelines don't share a common ancestor" GStreamer warnings, no pipeline stalls.

**DTMF** — `RTCDTMFSender.insertDTMF()` sends tones over audio tracks, with `tonechange` events firing for each digit.

**WebTorrent on GJS** — because WebRTC data channels are first-class, WebTorrent works end-to-end: peer discovery via WebSocket trackers, chunk exchange via RTCDataChannel, multi-file downloads with progress and SHA1 verification. See the `webtorrent-download` and `webtorrent-stream` examples.

**Zero config for consumers** — `gjsify build --globals auto` detects `RTCPeerConnection`, `RTCDataChannel`, etc. in your bundle and injects the right register modules automatically. No `--globals` flag, no source-level register import needed.

**302 tests** — a comprehensive suite ported from the W3C WPT test suite and the MDN samples covering the full lifecycle: data channels, offer/answer, ICE, media tracks, DTMF, RTP parameters, negotiationneeded, rollback, stats.

#### New examples

| Example | What it shows |
|---------|--------------|
| `webrtc-loopback` | Two local peers, data channel echo, string + binary |
| `webrtc-video` | Live webcam preview via `getUserMedia` + `VideoBridge` |
| `webrtc-trickle-ice` | ICE candidate gathering — collect and print all candidate types |
| `webrtc-dtmf` | Audio loopback with DTMF tone insertion and `tonechange` logging |
| `webrtc-states` | Adwaita GUI monitoring signaling/ICE/connection state transitions live |
| `webtorrent-download` | Multi-file torrent download with per-file progress and verification |
| `webtorrent-stream` | Chunk-by-chunk torrent streaming via WebRTC data channels |

#### Under the hood

The native `@gjsify/webrtc-native` Vala bridge solves GJS's streaming-thread restriction: GStreamer fires `on-ice-candidate`, `on-data-channel`, and pad signals on a C thread that GJS cannot enter. The bridge captures these on the C side and re-dispatches them via `GLib.Idle.add()` on the main context — making the async handshake safe without any polling.

---

* **webrtc:** W3C WebRTC API — Phase 1–4 complete (data channel + media + outgoing pipeline + DTMF) ([#23](https://github.com/gjsify/gjsify/issues/23)) ([3ff1df6](https://github.com/gjsify/gjsify/commit/3ff1df6cda08a34a97a13c2a8c2e17068e250bf7))

## [0.1.13](https://github.com/gjsify/gjsify/compare/v0.1.12...v0.1.13) (2026-04-16)

### Features

* **infra:** lower CSS Nesting for GTK4 via esbuild target=firefox60 ([#22](https://github.com/gjsify/gjsify/issues/22)) ([3c946c3](https://github.com/gjsify/gjsify/commit/3c946c35392af475fd1c539bf3734695073381af))

## [0.1.12](https://github.com/gjsify/gjsify/compare/v0.1.11...v0.1.12) (2026-04-16)

### Features

* **infra:** @gjsify/esbuild-plugin-css — resolve CSS [@import](https://github.com/import) at build time ([#21](https://github.com/gjsify/gjsify/issues/21)) ([812276a](https://github.com/gjsify/gjsify/commit/812276a32c9f2b659a63eef242a6236346feeee9))

## [0.1.11](https://github.com/gjsify/gjsify/compare/v0.1.10...v0.1.11) (2026-04-15)

### Features

* **cli:** GJS app packaging — --shebang + gresource + gettext ([#18](https://github.com/gjsify/gjsify/issues/18)) ([fe267c4](https://github.com/gjsify/gjsify/commit/fe267c41596cb22385cbab3a24c1b08a4747160d))
* **create-app:** multi-template scaffolding with 7 starter templates ([#16](https://github.com/gjsify/gjsify/issues/16)) ([7a97c8f](https://github.com/gjsify/gjsify/commit/7a97c8f5009059bddb4e2c8934de122f3e092701))
* **examples:** update start script to use 'yarn start:gjs' ([2ddecca](https://github.com/gjsify/gjsify/commit/2ddeccaed242328b5107b9f8091252443ac95e6d))

### Bug Fixes

* **dom,event-bridge:** close input gaps surfaced by Excalibur in GJS ([#17](https://github.com/gjsify/gjsify/issues/17)) ([f9f01da](https://github.com/gjsify/gjsify/commit/f9f01da2ab18871158738762a52ba8639708304c))

## Unreleased

### Features

* **dom:** Unified GTK-DOM Bridge Architecture — renamed all widget containers to bridges (`Canvas2DWidget`→`Canvas2DBridge`, `CanvasWebGLWidget`→`WebGLBridge`, `IFrameWidget`→`IFrameBridge`). New `@gjsify/bridge-types` package with shared `DOMBridgeContainer` interface and `BridgeEnvironment` (isolated document/body/window per bridge). New `@gjsify/video` package: `VideoBridge` renders `HTMLVideoElement` via `Gtk.Picture` + GStreamer `gtk4paintablesink`, supports `video.srcObject = mediaStream` (getUserMedia/WebRTC) and `video.src` (URI playback via playbin). New `HTMLMediaElement` and `HTMLVideoElement` in `@gjsify/dom-elements`. New `examples/dom/webrtc-video` example: webcam preview via VideoBridge. Long-term vision (deferred): universal DOM container where `document.createElement("canvas")` auto-creates the right GTK widget

* **webrtc:** Phase 3 — Outgoing media pipeline + `getUserMedia`. `RTCPeerConnection.addTrack(track)` wires a GStreamer encoder chain (source → valve → audioconvert/videoconvert → opusenc/vp8enc → rtpopuspay/rtpvp8pay → capsfilter → webrtcbin sink pad) using `request_pad_simple` to create the transceiver and sink pad in one step (avoids the double-transceiver problem with `emit('add-transceiver')` + `request_pad_simple`). `getUserMedia({ audio, video })` wraps GStreamer sources (pipewiresrc → pulsesrc → autoaudiosrc → audiotestsrc fallback) as `MediaStreamTrack` instances with `_gstSource` backing. `MediaDevices` class with `enumerateDevices` (stub) and `getSupportedConstraints`. `navigator.mediaDevices` registered via `@gjsify/webrtc/register/media-devices`. `MediaStreamTrack` extended with GStreamer integration: `enabled` → valve `drop` property, `stop()` → NULL + pipeline cleanup, `_setEnableCallback` for sender control. `RTCRtpSender._wirePipeline` builds explicit encoder chains entirely on the main thread (no Vala bridge needed). `RTCRtpSender.replaceTrack` with atomic source swap. `capsfilter` with RTP caps ensures `createOffer` generates `m=audio`/`m=video` lines immediately without waiting for data flow. End-to-end test verified: pcA sends getUserMedia audio → pcB receives track event, track unmutes. 26 new tests (total: 229). Single-PC-per-track limitation for v1. Continues [#14](https://github.com/gjsify/gjsify/issues/14).
* **webrtc:** Phase 2.5 — Incoming media pipeline via new `ReceiverBridge` Vala class. The bridge manages the muted source → decodebin → tee switching entirely in C (decodebin's `pad-added` fires on GStreamer's streaming thread, which GJS blocks). `RTCRtpReceiver._connectToPad` wires webrtcbin's output pad through the bridge; when decoded media replaces the muted source, the bridge emits `media-flowing` on the main thread and the track transitions from muted to unmuted. `RTCPeerConnection.close()` disposes all receiver bridges. 5 new tests (total: 203). Full muted→unmuted transition requires actual media flowing (getUserMedia / addTrack, deferred to Phase 3).
* **webrtc:** Phase 2 — Media API surface. Adds `RTCRtpTransceiver` (wraps `GstWebRTC.WebRTCRTPTransceiver` with direction read/write, stop, setCodecPreferences), `RTCRtpSender` (getParameters/setParameters, getCapabilities), `RTCRtpReceiver` (track, jitterBufferTarget 0–4000ms, getCapabilities), `MediaStream` (collection container with addtrack/removetrack events), `MediaStreamTrack` (stub with kind/label/enabled/muted/readyState/contentHint/clone/stop), `RTCTrackEvent`. `RTCPeerConnection.addTransceiver(kind, init)` creates real GstWebRTC transceivers; `getSenders/getReceivers/getTransceivers` return live lists; `track` event fires on `pad-added`. Globals via `@gjsify/webrtc/register/media`. Vala bridge extended with `on-new-transceiver` + `pad-added` signal forwarding. 109 new WPT-ported tests (total: 198). Actual media pipeline plumbing (decodebin, tee, getUserMedia) deferred to Phase 2.5. Continues [#14](https://github.com/gjsify/gjsify/issues/14).
* **webrtc:** new `@gjsify/webrtc` package — W3C WebRTC API backed by GStreamer `webrtcbin` — **Phase 1 + Phase 1.5 (data channel end-to-end)**. Ships the full JS surface: `RTCPeerConnection` (offer/answer, ICE trickle, STUN/TURN config, `createDataChannel`, `close`, all sync state getters + `on<event>` attribute handlers), `RTCDataChannel` (string + binary send/receive, bufferedAmount, binaryType), `RTCSessionDescription` (Gst ↔ JS roundtrip via GstSDP), `RTCIceCandidate` (RFC 5245 candidate-line parser), `RTCError` (extends DOMException), `RTCPeerConnectionIceEvent`, `RTCDataChannelEvent`, `RTCErrorEvent`. Wires `globalThis.RTC*` via granular register subpaths (`@gjsify/webrtc/register/{peer-connection,data-channel,error}`) picked up automatically by `gjsify build --globals auto` — no source-level import needed in consumer projects. The async handshake works end-to-end on GJS via the new **`@gjsify/webrtc-native`** Vala bridge (see below). Tests: 23 green including full local-loopback (two peers, offer/answer, ICE trickle, data-channel open/send/receive/echo). Media (RTCRtpSender/Receiver, MediaStream, getUserMedia) deferred to Phase 2. System prerequisites: GStreamer ≥ 1.20 with `gst-plugins-bad` + `libnice-gstreamer1` (Fedora) / `gstreamer1.0-plugins-bad` + `gstreamer1.0-nice` (Ubuntu). Initial foundation work for [#14](https://github.com/gjsify/gjsify/issues/14); references: [refs/node-gst-webrtc/](refs/node-gst-webrtc/) (ISC, Ratchanan Srirattanamet) + [refs/node-datachannel/polyfill/](refs/node-datachannel/src/polyfill/) (MIT). New private example: `examples/dom/webrtc-loopback` — two local peers exchange offer/answer + ICE and echo strings/binary over a data channel.
* **webrtc-native:** new `@gjsify/webrtc-native` package — native Vala/GObject signal bridge consumed by `@gjsify/webrtc` to work around the GJS streaming-thread block. Exposes three main-thread signal bridges: `WebrtcbinBridge` (wraps webrtcbin's `on-negotiation-needed` / `on-ice-candidate` / `on-data-channel` + `notify::*-state`), `DataChannelBridge` (wraps GstWebRTCDataChannel's `on-open` / `on-close` / `on-error` / `on-message-string` / `on-message-data` / `on-buffered-amount-low` + `notify::ready-state`), `PromiseBridge` (wraps `Gst.Promise.new_with_change_func`). Each bridge connects on the C side (never invokes JS on the streaming thread), captures args, then re-emits mirror signals via `GLib.Idle.add()` on the main context. `WebrtcbinBridge` eagerly wraps incoming data channels into a `DataChannelBridge` on the streaming thread to avoid a race where early remote messages would arrive before JS-side setup. Ships as prebuilt `.so` + `.typelib` in `prebuilds/linux-{x86_64,aarch64}/`; CI (`.github/workflows/prebuilds.yml`) rebuilds on Vala source changes. The CLI's `detectNativePackages` now merges native-package discoveries across all `node_modules` dirs up the filesystem (instead of stopping at the first hit) so example/workspace projects transparently find root-hoisted prebuilds in yarn v4 hoisted mode.
* **infra:** `@gjsify/esbuild-plugin-css` — GTK4 CSS Nesting lowering. The GJS app target now defaults `css.target` to `['firefox60']` so esbuild lowers CSS Nesting (unsupported by GTK4's CSS parser) at build time: authored `.parent { &:hover { … } }` becomes `.parent:hover { … }` in the bundled string. Features GTK4 *does* support (`var()`, `calc()`, `:is()`, `:where()`, `:not()`) are preserved. Override via `gjsify.config.js` → `esbuild.css.target` if your GTK version accepts newer CSS. Browser + node targets still inherit the parent build's target. Demonstrated in the `adwaita-package-builder` showcase: `runtime-style.css` contains a nested `&:hover` rule; the bundled binary shows it flattened
* **infra:** new `@gjsify/esbuild-plugin-css` package. Bundles `.css` imports into a JS string at build time, resolving `@import` statements (including node_modules via `package.json#exports`) through esbuild's own resolver. Wired into `gjsify build` for GJS, browser, and node targets. Fixes the runtime GTK CSS Theme-parser warnings that occurred because `Gtk.CssProvider.load_from_string()` cannot resolve `@import "@scope/pkg/style.css"` at runtime — the imports are now resolved at build time. Config via `PluginOptions.css` (`{ minify, target }`, both default to the parent build's values)
* **showcases:** new `adwaita-package-builder` showcase — minimal Adwaita app demonstrating `gjsify gresource`, `gjsify gettext`, and `gjsify build --shebang` in a single build pipeline. Produces a directly-executable binary with an embedded GResource (CSS) and per-language `.mo` translations (de/es). Serves as the `gjsify showcase adwaita-package-builder` reference for "how to package a GJS/GNOME app with the gjsify CLI alone"

### Bug Fixes

* **cli/gettext:** `--format mo` no longer passes an invalid `--mo` flag to `msgfmt`. `msgfmt` produces a `.mo` file by default when no format flag is given; the `--mo` pseudo-flag never worked and caused every `gettext --format mo` invocation to fail with "Unbekannte Option »--mo«"
* **cli/gresource:** create the target directory automatically before invoking `glib-compile-resources`. Previously a target like `dist/app.gresource` failed with ENOENT when `dist/` did not exist, because `glib-compile-resources` writes a temp file next to the target

### Tests

* **event-bridge:** new `event-bridge.spec.ts` regression suite verifying the `motion` handler reads widget-local coords from the signal callback (NOT from `controller.get_current_event().get_position()`, which returns surface-local coords and produced a drag-jump on first move after click). Covers coord forwarding, clamping to widget allocation, and movementX/Y tracking across successive motions
* **cli-only E2E:** added coverage for `gjsify build --shebang` (shebang prepend + `chmod 0o755` + idempotence on repeated builds), `gjsify gresource` (binary bundle produced, `gresource list` lists the embedded path), and `gjsify gettext --format mo` (per-language locale tree under `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`). Skips gracefully when `glib-compile-resources` / `msgfmt` are not installed

## [0.1.10](https://github.com/gjsify/gjsify/compare/v0.1.9...v0.1.10) (2026-04-11)

### Features

* **showcases:** add focus to canvas widgets on initialization ([c2a1e4b](https://github.com/gjsify/gjsify/commit/c2a1e4b932aa347e0bbd64887db18e45c9b9bdb1))
* **website:** show Express.js example first in showcase slideshow ([5d8fe22](https://github.com/gjsify/gjsify/commit/5d8fe22be38d48705e1851dc7eef2f99374755e1))
* **website:** streamline docs with Quick Start, collapsible sections and CTA ([9f8a10e](https://github.com/gjsify/gjsify/commit/9f8a10e434fcd0151ee9d71e2f1e9b71b1e2f327))

### Bug Fixes

* **website:** rename Express showcase title to express-webserver.ts ([e86b055](https://github.com/gjsify/gjsify/commit/e86b055d387e1f4e149fc3b7c152fe3a154cdd25))

## [0.1.9](https://github.com/gjsify/gjsify/compare/v0.1.8...v0.1.9) (2026-04-11)

### Features

* **build:** --globals auto — two-pass esbuild analysis ([#15](https://github.com/gjsify/gjsify/issues/15)) ([943f61c](https://github.com/gjsify/gjsify/commit/943f61c972e9b01b93f933191c60128b370cd0a4))
* **showcase:** excalibur-jelly-jumper — 2D platformer + Browser API stubs ([#13](https://github.com/gjsify/gjsify/issues/13)) ([63e7c25](https://github.com/gjsify/gjsify/commit/63e7c25046527f9cb61c32ff634e78b503cbb786))

## Unreleased (2026-04-10)

### Features

* **webaudio:** new `@gjsify/webaudio` package — Web Audio API for GJS backed by GStreamer 1.26. Implements AudioContext, decodeAudioData (MP3/WAV/OGG/FLAC via GStreamer decodebin), AudioBufferSourceNode (per-play pipeline: appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), AudioBuffer (PCM Float32Array), HTMLAudioElement (canPlayType + playbin). 29 tests. Phase 1 — covers Excalibur.js audio needs
* **showcase:** add Excalibur Jelly Jumper — 2D platformer running natively on GJS/GTK4 and in the browser ([#13](https://github.com/gjsify/gjsify/pull/13)). Based on [excaliburjs/sample-jelly-jumper](https://github.com/excaliburjs/sample-jelly-jumper)
* **canvas2d:** HSL/HSLA color parsing, shadow blur approximation, pixel-perfect font rendering via FontFace + PangoCairo
* **webgl:** premultipliedAlpha support, clearBufferfv/iv/uiv/fi WebGL2 entry points, eager context init, uniform name resolution
* **dom-elements:** HTMLElement.dataset (DOMStringMap proxy), HTMLImageElement data: URI support
* **dom-elements:** stub `window.scrollX`, `window.scrollY`, `window.pageXOffset`, `window.pageYOffset` to `0`. GTK widgets have no page-scroll concept; without these stubs Excalibur's `getPosition()` computed `rect.x + undefined = NaN`, NaN-poisoning every pointer coordinate and producing a blank canvas on any drag/pan
* **dom-elements:** add `onwheel` property getter/setter to `HTMLElement`. Excalibur feature-detects wheel support via `'onwheel' in document.createElement('div')` and silently omits its wheel listener when the property is missing — previously wheel events flowed through event-bridge but never reached game code
* **event-bridge:** `motion` handler now uses widget-local coordinates from the `Gtk.EventControllerMotion::motion` signal directly, matching the coordinate frame used by `GestureClick::pressed`. Previously it pulled coords from `controller.get_current_event().get_position()` which returns surface-local coords, causing drag anchors to jump on the first move after a click
* **event-bridge:** wire keyboard input to window-level listeners
* **fetch:** support file:// URIs + root-relative URL rewrite for GJS
* **gamepad:** new `@gjsify/gamepad` package — Gamepad Web API for GJS backed by libmanette 0.2. Implements Gamepad, GamepadButton, GamepadEvent, GamepadHapticActuator (dual-rumble). Bridges libmanette's event-driven signals to W3C polling-based navigator.getGamepads(). Button/axis mapping from Manette enums to W3C standard layout. Lazy Monitor init + graceful degradation. 19 tests. Enables controller support in excalibur-jelly-jumper showcase
* **cli:** `--shebang` flag on `gjsify build` — after a successful GJS app build, prepends `#!/usr/bin/env -S gjs -m` to the outfile and sets it executable (`chmod 0o755`). Turns the bundle into a standalone, directly-executable GJS binary (e.g. `./org.myapp.Maker`) without a separate launcher script
* **cli:** new `gjsify gresource <xml>` command — thin wrapper around `glib-compile-resources` with `--sourcedir` and `--target` options. Default target is derived from the XML descriptor filename. Mirrors the meson/autotools step for packaging UI templates and assets into a binary `.gresource` bundle
* **cli:** new `gjsify gettext <poDir> <outDir>` command — wraps `msgfmt` for translation workflows. Supports `--format mo` (per-language locale tree `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`, default), `xml` (metainfo template substitution via `msgfmt --template`, with optional `--remove-xml-comments`), `desktop`, and `json`. Replaces hand-rolled shell scripts in GNOME app build pipelines

### Bug Fixes

* **canvas2d:** drawImage via paint+clip, composite operation mapping
* **webgl:** offsetWidth/offsetHeight for Excalibur, extractImageData fix
* **showcase/jelly-jumper:** circular saw rotation precision, outline shader init, TypeScript type errors, MSAA disable, browser sprite rendering

### Chores

* **showcase/jelly-jumper:** clean up leftover files from original repo (.github, vite.config.ts, package-lock.json, social.jpg, .prettierrc, etc.), move assets from public/res/ to src/assets/, align structure with other showcases

## [0.1.8](https://github.com/gjsify/gjsify/compare/v0.1.7...v0.1.8) (2026-04-08)

### ⚠ BREAKING CHANGES

* **globals:** importing the root `@gjsify/<pkg>` module of a
global-providing package no longer registers globals. Callers must
explicitly import the `/register` subpath (`@gjsify/fetch/register`,
`@gjsify/abort-controller/register`, …) or use the aliased bare
specifier (`import 'fetch/register'`, `import 'abort-controller/register'`,
…). Stage 3 will add automatic injection via the esbuild plugin, so
this manual step disappears again for typical projects.

Stage 2 of the refactor plan at .claude/plans/indexed-popping-sloth.md.
* **globals:** projects that relied on `@gjsify/node-globals` to
implicitly register `fetch`, `Headers`, `Request`, `Response`,
`AbortController` or `AbortSignal` must now either import
`@gjsify/web-globals` or import the specific bare specifier
(`import 'fetch'`, `import 'abort-controller'`).

Stage 1 of the refactor plan at
.claude/plans/indexed-popping-sloth.md — next stages will introduce
`/register` subpaths and auto-injection in the esbuild plugin.

### Features

* **build:** stage 3 — auto-inject /register modules via esbuild plugin ([9f4018b](https://github.com/gjsify/gjsify/commit/9f4018bd52f0349d1fa083d9d5d192adc05b1cc4))
* **create-app:** livelier template showing Node.js + Web Crypto + Buffer ([94517d9](https://github.com/gjsify/gjsify/commit/94517d9b4bd4d7fdb77be4f02fd30be6864bd17c))
* **create-app:** template als echtes Workspace-Package ([89fecbf](https://github.com/gjsify/gjsify/commit/89fecbfe36cf853b9679cda876e0234315ef2431))
* **globals:** add node/web/dom group aliases for --globals flag ([4443779](https://github.com/gjsify/gjsify/commit/44437794ed7945d94c73c8f4041dffab53302d25))
* separate showcases from examples ([#5](https://github.com/gjsify/gjsify/issues/5)) ([086bbd0](https://github.com/gjsify/gjsify/commit/086bbd0c9f89b841b21acf13b69b0132d949eb2c)), closes [#222226](https://github.com/gjsify/gjsify/issues/222226) [#ffffff](https://github.com/gjsify/gjsify/issues/ffffff) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4) [#78aeed](https://github.com/gjsify/gjsify/issues/78aeed) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#613583](https://github.com/gjsify/gjsify/issues/613583) [#c061cb](https://github.com/gjsify/gjsify/issues/c061cb) [#dc8add](https://github.com/gjsify/gjsify/issues/dc8add) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4)

### Bug Fixes

* **ci:** add blueprint-compiler to release workflow prerequisites ([0184b65](https://github.com/gjsify/gjsify/commit/0184b65867bfa3428377494e81e12436a752c596))
* **ci:** add libadwaita-devel to release workflow for blueprint compilation ([dc44b34](https://github.com/gjsify/gjsify/commit/dc44b34a86d334169299333741365d850705cc78))
* **ci:** build adwaita-web SCSS before website build ([460b932](https://github.com/gjsify/gjsify/commit/460b932afc7c0ca0b46a9b3a42a1784bd8a5ffc9))
* **create-app:** add check script to template, fix set_child typo ([4290b92](https://github.com/gjsify/gjsify/commit/4290b92b137bb3f709813c1fb627ea6d2698b9ea))
* **package:** update astro dependency to version 6.1.5 ([77ad702](https://github.com/gjsify/gjsify/commit/77ad70279e414edd9e0e05efa9b2959342d090d6))

### Code Refactoring

* **globals:** stage 1 — drop fetch/abort-controller from node-globals ([#6](https://github.com/gjsify/gjsify/issues/6)) ([94464bd](https://github.com/gjsify/gjsify/commit/94464bdc0a9a215f165ea1cba9445aabd81c4b89))
* **globals:** stage 2 — introduce /register subpath exports ([66957b9](https://github.com/gjsify/gjsify/commit/66957b9bf2bff7e3088f76be45627a578f96abbf))

## Unreleased

### ⚠ BREAKING CHANGES

* **node-globals:** `@gjsify/node-globals` no longer auto-registers `fetch`, `Headers`, `Request`, `Response`, `AbortController` or `AbortSignal`. These are Web APIs, not Node.js globals — importing them automatically pulled the full WHATWG Streams implementation into every bundle even when unused (~80 KB dead weight on a minimal Express app). Projects that need these APIs on GJS should now either:
  - Import `@gjsify/web-globals` to get the full Web API set, or
  - Import the specific package side-effect bundle, e.g. `import 'fetch'` or `import 'abort-controller'` (the aliases resolve to the correct GJS/Node package automatically).
* **node-globals:** The empty `ReadableStream`/`Blob` placeholder stubs in `@gjsify/node-globals` are removed. `Blob`/`File` remain available because `@gjsify/buffer` (still imported by node-globals) registers them. `ReadableStream` is only registered when something actually imports `@gjsify/streams` or a package that depends on it.

### Features

* **cli:** add `gjsify create <name>` subcommand that delegates to `@gjsify/create-app`, so users only need to remember a single npm scope (`@gjsify/cli`) to scaffold, build and run GJSify projects
* **create-app:** expose `createProject()` as a programmatic export (`import { createProject } from '@gjsify/create-app'`) in addition to the existing CLI entry

### Refactor

* **globals:** drop `fetch` and `abort-controller` side-effect imports from `@gjsify/node-globals` and `@gjsify/dom-elements`. Stage 1 of the globals tree-shaking refactor. Express showcase bundle shrinks from 1.83 MB → 1.68 MB (-157 KB, -8.5 %), WHATWG Streams references drop from 186 to 9.
* **fs:** make `FileHandle.readableWebStream()` resolve the `ReadableStream` constructor lazily from `globalThis` instead of importing `node:stream/web` at module load time. Apps that never call `readableWebStream()` no longer ship the full WHATWG Streams polyfill. Stage 1 of the globals tree-shaking refactor.
* **globals:** Stage 2 of the globals tree-shaking refactor — introduce `/register` subpath exports on every global-providing package. The root `@gjsify/<pkg>` exports are now pure named exports with no side effects; side-effects live in `@gjsify/<pkg>/register`. Meta-packages (`@gjsify/node-globals`, `@gjsify/web-globals`) are rewired to chain `/register` subpaths. Internal package dependencies (compression-streams → web-streams, webcrypto → dom-exception) now use pure named imports. Canvas2D fireworks showcase shrinks from 837 KB → 641 KB (-196 KB, -23.4 %). Packages migrated: `abort-controller`, `buffer`, `compression-streams`, `dom-elements`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `node-globals`, `web-globals`, `web-streams`, `webcrypto`. New bare-specifier aliases: `abort-controller/register`, `fetch/register`, `webcrypto/register`, etc. — resolve to the appropriate `/register` subpath on GJS and to `@gjsify/empty` on Node.
* **globals:** explicit `--globals` CLI flag for controlling which `/register` modules ship in the bundle. Users declare needed globals as a comma-separated list (`--globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController`); the CLI resolves each identifier against `GJS_GLOBALS_MAP`, writes a small ESM stub under `node_modules/.cache/gjsify/`, and passes it to the plugin via `autoGlobalsInject`. The plugin appends the stub to esbuild's `inject` list. The `@gjsify/create-app` template `package.json` ships with a sensible default list pre-wired into the `build` script, so typical Node-style apps work out of the box. There is deliberately no automatic scanning of user code — heuristic scanners (regex on entry points, AST on entry points, two-pass metafile scan across transitive deps) were prototyped and all three leaked in different ways (shadowed identifiers, isomorphic library guards, dynamic imports, bracket-notation global access). Explicit declaration keeps the CLI layer minimal and build output predictable.

### Features

* **cli/build:** add `--globals <list>` flag to `gjsify build` — comma-separated list of global identifiers to register in the bundle (e.g. `--globals fetch,Buffer,process`).

### Bug Fixes

* **website:** build `@gjsify/adwaita-web` SCSS as a prerequisite of the website build so `deploy-docs` CI (which runs only `yarn workspace @gjsify/website build`) can resolve `@gjsify/adwaita-web/style.css` after the CSS-in-JS → SCSS refactor

### Documentation

* **website:** refactor top-level docs to target framework users instead of monorepo contributors — new Getting Started walks through `npx @gjsify/cli create my-app` instead of `git clone`
* **website:** new `CLI Reference` and `How It Works` pages under `Documentation`
* **website:** move contributor docs (Architecture, TDD Workflow, Development Setup) into a dedicated top-level `Contributing` sidebar group
* **website:** home page cards for Node.js APIs, Web APIs and DOM & Graphics now link directly to their respective Packages pages

## [0.1.7](https://github.com/gjsify/gjsify/compare/v0.1.6...v0.1.7) (2026-04-04)

### Bug Fixes

* **ci:** build examples before npm publish in release workflow ([027a729](https://github.com/gjsify/gjsify/commit/027a72985899d4acd91f47bb6d5799b3b020a82d))

## [0.1.6](https://github.com/gjsify/gjsify/compare/v0.1.5...v0.1.6) (2026-04-04)

### Bug Fixes

* **publish:** build examples before npm publish + lint for missing dist ([eba07a5](https://github.com/gjsify/gjsify/commit/eba07a5b98ad10b77bc99827334cd53490c619b9))
* **refs:** update subproject commits for bun, deno, and undici ([e1751dd](https://github.com/gjsify/gjsify/commit/e1751dd0cd041c61bb0270326312b54e18a687da))
* **svg:** update favicon and logos ([4699da6](https://github.com/gjsify/gjsify/commit/4699da6dbc2a0f220e243deec2cc13862cf9bece))

## [0.1.5](https://github.com/gjsify/gjsify/compare/v0.1.4...v0.1.5) (2026-04-04)

### Bug Fixes

* **cli:** resolve gwebgl from CLI location, not user's cwd ([686c53d](https://github.com/gjsify/gjsify/commit/686c53dc6eac5ff2f0d8df54eefd0c365512e02d))
* **cli:** resolve npm packages from project first, CLI as fallback ([8d81c97](https://github.com/gjsify/gjsify/commit/8d81c97ef20f3eea5e79e0851d33344d5013fa31))

## [0.1.4](https://github.com/gjsify/gjsify/compare/v0.1.3...v0.1.4) (2026-04-03)

### Bug Fixes

* **examples:** update outdated engines fields and add lint check ([c27ad7c](https://github.com/gjsify/gjsify/commit/c27ad7cbd777299d99c87bbed5916cc3a4d357f2))

## [0.1.3](https://github.com/gjsify/gjsify/compare/v0.1.2...v0.1.3) (2026-04-03)

### Features

* add documentation link to README ([3e10f75](https://github.com/gjsify/gjsify/commit/3e10f751fda846bddc9c06d875935b0b3c8bf0fc))
* add release:patch script to package.json for patch releases ([f07f30a](https://github.com/gjsify/gjsify/commit/f07f30a243331871457f179291578dafe0fa870f))
* documentation site, WebGL conformance, CLI showcase, dependency updates ([#3](https://github.com/gjsify/gjsify/issues/3)) ([db41f07](https://github.com/gjsify/gjsify/commit/db41f07551d48282161458bb2648cb28560767a2)), closes [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version)
* include website package.json in release-it bumper configuration ([58d4242](https://github.com/gjsify/gjsify/commit/58d42421bcc11e55824df6086682524983caf397))
* update favicon to SVG format and replace logo with new design ([f8e0f46](https://github.com/gjsify/gjsify/commit/f8e0f4615b19386f598101ecdb86c01d71994683))

# gjsify — Changelog

### 2026-04-07 — TypeScript: Spec Files Now Type-Checked Monorepo-Wide

**Problem:** VSCode raised `Cannot find name 'node:stream'` on every `*.spec.ts` that imported `node:*` modules. Root cause: all 60 package tsconfigs excluded `src/**/*.spec.{ts,mts}` from their `include`, so the IDE's language server fell back to an inferred project without `@types/node`. `yarn check` (`tsc --noEmit`) was also silently skipping all spec files.

**Fix:**
- Removed the `src/**/*.spec.{ts,mts}` exclusions from 58 package tsconfigs. VSCode's auto-discovered project now covers spec files and loads `@types/node` for them; `yarn check` now actually type-checks specs.
- `packages/dom/webgl/tsconfig.json` re-excludes spec files as a special case — they don't import `node:*` (so the user complaint doesn't manifest) but have pre-existing global DOM `WebGLRenderingContext` vs class-type conflicts that would otherwise flood the check with ~100 errors.
- Added TypeScript `paths` mappings in 9 web tsconfigs (`abort-controller`, `compression-streams`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `formdata`, `websocket`, `webstorage`) pointing each bare web alias to `./src/index.ts` so specs that use the `AGENTS.md`-mandated bare-specifier imports type-check without build-time esbuild alias resolution.
- Ambient module declarations in `packages/web/dom-events/src/spec-aliases.d.ts` and `packages/node/events/src/spec-aliases.d.ts` cover cross-package bare imports (`abort-controller`) without requiring cross-rootDir path mappings.
- `packages/node/stream/src/spec-internals.d.ts`: ambient module augmentation exposing `_readableState`/`_writableState` for white-box tests that probe stream internals.

**Spec type errors surfaced and fixed:**
- `as any` casts added for test-only invalid arguments (perf_hooks `EntryType` literal, webcrypto `Float32Array`, sqlite unsupported values, `crypto.KeyObject` private constructor, `KeyObject.export` format-only options, `http2.getPackedSettings()` zero-arg, `readline.cursorTo` 3-arg, `http.IncomingMessage` zero-arg).
- Type augmentations for Node internals missing from `@types/node`: `StringDecoder.encoding`, `dgram.Socket.type`, `http.Agent.{defaultPort, keepAlive, keepAliveMsecs, scheduling}`, `http2.constants.{NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL, DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE, HTTP2_HEADER_PROTOCOL}`.
- Explicit narrowing for `server.address(): string | AddressInfo | null` (net spec).
- String/Buffer narrowing for `'data'` event handlers in net specs.
- JSON result typing in fetch and stream-consumers specs.
- Loosened `tracingChannel`/`channel` types via local `as any` aliases for the many handler shapes in the diagnostics_channel spec.
- Renamed shadowed `resolve` in dns spec (promise resolve shadowed `dns.resolve`).
- Unused import/variable cleanup in canvas2d, dom-elements, webgl/textures specs.
- Added `declare readonly isTrusted: boolean` on `@gjsify/dom-events` `Event` class so white-box `isTrusted` access in specs type-checks (runtime behaviour unchanged — set via `Object.defineProperty` in the constructor).

**Documentation:**
- `AGENTS.md`: added explicit rule — "Changelog entries live ONLY in CHANGELOG.md. Do NOT add dated 'Latest:' lines, changelog highlights, or per-session summaries to STATUS.md."
- `STATUS.md`: removed the dated "Latest:" line pattern; `## Changelog` section now just points to CHANGELOG.md.
- `packages/node/events/src/callable.spec.ts`: header comment updated — the EventEmitter callable work is no longer a TODO, these specs are its regression coverage.

**Verification:** `yarn check` clean across the monorepo, `yarn build` succeeds, `yarn test` → 53,310 tests passing.

### 2026-04-07 — Stream GJS Fixes: 36→0 Failures, 509 Tests Passing on Both Platforms

**`@gjsify/stream` — GJS implementation fixes (all 36 GJS failures resolved):**

- **`_readableState` / `_writableState` fields** — both now expose `highWaterMark`, `objectMode`, and `pipes` (array), populated in constructors; required by tests that access internal state directly
- **`Writable_.Symbol.hasInstance`** — static `[Symbol.hasInstance]` added: checks prototype chain first (for real subclasses), then sentinel-guarded duck-type check (`writableHighWaterMark` numeric property) so `duplex instanceof Writable` and `transform instanceof Writable` work through the `makeCallable` Proxy
- **Split `highWaterMark` options** — `Duplex_` constructor now correctly handles `highWaterMark` (overrides both sides), `readableHighWaterMark`, and `writableHighWaterMark` independently; NaN validation added for all HWM options
- **Drain condition HWM=0** — `writableNeedDrain` drain check changed from `<` to `<=` so drain fires when `writableLength <= writableHighWaterMark` (critical for HWM=0 case where `0 < 0` is always false)
- **`Transform_` complete redesign:**
  - Constructor assigns `opts.transform`/`opts.flush`/`opts.final` directly as instance properties (`t._transform === opts.transform` equality holds)
  - `ERR_METHOD_NOT_IMPLEMENTED` re-throws synchronously from `_write` (test introspects the throw); other user-provided `_transform` errors become 'error' events
  - `ERR_MULTIPLE_CALLBACK` — `called` flag in `_write` detects second callback invocation and emits error
  - `_doPrefinishHooks` virtual method on `Duplex_` called between `_final` and `finish`; `Transform_` overrides it to run built-in `_final` (flush+push-null) when user supplied a custom `_final`
- **`Readable_.push()` type validation** — non-objectMode pushes of plain objects emit `ERR_INVALID_ARG_TYPE` error
- **`_destroy` virtual method** — `Readable_._destroy(error, callback)` prototype method added; `destroy()` calls `this._destroy()` so instance-overridden `_destroy` works correctly
- **`Stream_.pipe()` cleanup** — `source.on('end', cleanup)` removes all listeners when 'end' fires; `onclose` skips `destroy(dest)` for modern `Readable_` instances to avoid premature close
- **`unpipe()` sync** — maintains `_readableState.pipes` alongside `_pipeDests`

**`@gjsify/util` — `inherits` error codes:**
- All three validation throws now attach `code: 'ERR_INVALID_ARG_TYPE'` matching Node.js behaviour

**Test coverage:**
- Node.js: 507 tests passing | GJS: 509 tests passing (0 failures, up from 36)
- Stream spec files: 7 (readable, writable, duplex, transform, pipe, inheritance + base)

**AGENTS.md:**
- Added note: internal modules may import `@gjsify/stream` directly for non-standard exports; public code must use `node:stream`

### 2026-04-01 — DOM API, WebGL2, Blueprint, Adwaita Web, Three.js Teapot

**DOM API enhancements (`@gjsify/dom-elements`):**
- `Node.ownerDocument` returns `document` singleton (lazy, avoids circular deps)
- Event bubbling via `Node.dispatchEvent` override — walks parentNode chain
- `Document` establishes DOM tree: document → documentElement → body
- `Element`: `setPointerCapture()`, `releasePointerCapture()`, `hasPointerCapture()`
- `HTMLElement`: `getBoundingClientRect()` stub (uses clientWidth/clientHeight)
- Browser globals on import: `globalThis.self`, `devicePixelRatio`, `alert`

**WebGL2 fixes (`@gjsify/webgl`):**
- `WebGL2RenderingContext` overrides `texImage2D`, `texSubImage2D` — bypasses WebGL1 format validation (RGBA8, RGB8, SRGB8_ALPHA8 etc.)
- `WebGL2RenderingContext` overrides `drawElements` — UNSIGNED_INT as core feature (no extension gate)
- `CanvasWebGLWidget`: resize dispatches DOM event + re-invokes last rAF callback

**Blueprint support:**
- New `@gjsify/esbuild-plugin-blueprint` — compiles `.blp` → XML via `blueprint-compiler`
- Wired into `esbuild-plugin-gjsify` for GJS and browser targets
- Type declaration: `@gjsify/esbuild-plugin-blueprint/types`

**Adwaita web components (`@gjsify/adwaita-web`):**
- 5 Custom Elements (light DOM): AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwComboRow
- Embedded Adwaita CSS with light/dark theme (canonical colors from libadwaita)
- Adwaita Sans font via @font-face
- `notify::active` / `notify::selected` events mirror GJS GObject signals

**Three.js teapot example (`examples/gtk/three-geometry-teapot/`):**
- First Adwaita example: Adw.Application + Blueprint template
- First OrbitControls usage (event bridge validation)
- Dual-target: GJS native + browser with @gjsify/adwaita-web
- New convention: `src/gjs/` + `src/browser/` + shared `three-demo.ts`
- 6 shading modes (wireframe, flat, smooth, glossy, textured, reflective)

**New reference submodules:** `refs/adwaita-web`, `refs/libadwaita`, `refs/adwaita-fonts`, `refs/app-mockups`

### 2026-03-27 — WebGL Refactor: HTMLCanvasElement Inheritance, WebGLArea Widget

**Goal: enable browser-targeted game engines (e.g. Excalibur) to run on GJS/GTK with minimal changes.**

**Base `HTMLCanvasElement` in `@gjsify/dom-elements`:**
- New `packages/dom/dom-elements/src/html-canvas-element.ts` — DOM-spec base class extending `HTMLElement`
- Stubs for `getContext()`, `toDataURL()`, `toBlob()`, `captureStream()` (overridden in `@gjsify/webgl`)
- Side-effect globals on import: `Object.defineProperty(globalThis, 'HTMLCanvasElement', ...)`, `HTMLImageElement`, `Image` — same pattern as `@gjsify/node-globals` and `@gjsify/web-globals`
- Removes the `// TODO move this to dom globals` boilerplate from all WebGL examples

**`@gjsify/webgl` real inheritance + class renames:**
- Removed the fake interface trick (`export interface GjsifyHTMLCanvasElement extends HTMLCanvasElement {}`)
- `GjsifyHTMLCanvasElement` → `HTMLCanvasElement` — now extends `BaseHTMLCanvasElement` from `@gjsify/dom-elements`, overrides `width`/`height` getters with `Gtk.GLArea` allocated size
- `GjsifyWebGLRenderingContext` → `WebGLRenderingContext` (and all other `Gjsify*` class prefixes removed — 136 occurrences across 29 files)
- `getContext('webgl')` creates `WebGLRenderingContext` lazily via `??=`

**New `WebGLArea` widget (`packages/dom/webgl/src/ts/webgl-area.ts`):**
- `Gtk.GLArea` subclass registered with `GObject.registerClass({ GTypeName: 'GjsifyWebGLArea' }, ...)`
- Sets up ES 3.2 context + depth buffer + stencil buffer automatically
- `onWebGLReady(cb: (canvas, gl) => void)` — fires once GL context is initialized
- `requestAnimationFrame(cb)` — backed by `GLib.idle_add` + render signal (replaces per-example boilerplate)
- `installGlobals()` — sets `globalThis.requestAnimationFrame` scoped to this widget
- Handles `unrealize` cleanup (disconnects render handler, removes idle source)

**VAPI cleanup:**
- Deleted unused `packages/dom/webgl/src/vapi/glesv2.vapi` (Vala source uses `using GL;` from `epoxy.vapi` only)
- Updated `epoxy.vapi` header: removed vapigen-generated comment, added attribution to valagl

**Examples refactored (6 files):**
- `examples/gtk/webgl-tutorial-02` through `07` and `webgl-demo-fade` simplified from 60–120 lines → 22–33 lines
- All manual `Gtk.GLArea` setup, `requestAnimationFrame` implementations, and `globalThis.Image =` assignments removed
- All now use `new WebGLArea()` + `glArea.installGlobals()` + `glArea.onWebGLReady((canvas) => start(canvas))`

### 2026-03-27 — Restructure: new `packages/dom/` category

**New package category `packages/dom/` for DOM/platform-specific packages:**
- Moved `dom-elements` from `packages/web/` → `packages/dom/`
- Moved `webgl` from `packages/web/` → `packages/dom/`
- Merged `html-image-element` into `dom-elements` (HTMLImageElement, Image now part of @gjsify/dom-elements)
- Updated `@gjsify/webgl` dependency: `html-image-element` → `dom-elements`
- Updated root `package.json` workspaces, `meson.build`, WebGL example scripts, CLAUDE.md, STATUS.md

### 2026-03-27 — HTTP Upgrade Event, Web Globals, Client Auth, Test Coverage

**HTTP Server upgrade event:**
- `server.on('upgrade', (req, socket, head) => {...})` for custom protocol upgrades
- Uses `Soup.ServerMessage.steal_connection()` to take over raw TCP connection
- Socket is a net.Socket Duplex wrapping the stolen Gio.IOStream
- Note: WebSocket upgrades (`Upgrade: websocket`) are handled by Soup internally via `addWebSocketHandler()`

**HTTP Client improvements:**
- `auth` option for Basic authentication (`http.request({auth: 'user:pass'})`)
- `signal` option for AbortController support
- `localAddress` and `family` options in ClientRequestOptions
- Agent constructor options: `keepAlive`, `maxSockets`, `maxTotalSockets`, `maxFreeSockets`, `scheduling`
- Agent exposes `requests`/`sockets`/`freeSockets` objects for framework compatibility

**Web Globals consolidation:**
- `@gjsify/web-globals` now registers: URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver
- Previously only: DOMException, Event/EventTarget, AbortController, Streams, Compression, WebCrypto, EventSource

**Net Socket IOStream support:**
- `net.Socket._setupFromIOStream()` creates sockets from raw `Gio.IOStream` (for stolen connections)
- Proper IOStream lifecycle: `_final()` closes entire SoupIOStream for proper EOF signaling
- `@gjsify/net` exports `./socket` subpath for direct internal imports

**New tests (+200):**
- HTTP: 995→1034 (+39): upgrade event (5 tests), auth option (3), Agent constructor (8), signal option, round-trip
- Net: 361→378 (+17): destroy idempotency, getConnections, maxConnections, address info, bytesWritten/bytesRead
- Web-Globals: 45→66 (+21): URL/URLSearchParams, Blob/File, FormData, Performance globals

### 2026-03-26 — Networking Hardening, Timeout Enforcement, Stream Edge Cases

**HTTP Server improvements:**
- **Chunked streaming**: ServerResponse now uses `Soup.Encoding.CHUNKED` for true streaming via `responseBody.append()` instead of buffering the entire response. Each `res.write()` flushes a chunk.
- **Timeout enforcement**: `ServerResponse.setTimeout()`, `IncomingMessage.setTimeout()`, and `ClientRequest.setTimeout()` now emit `'timeout'` events via actual timers (previously properties existed but were inert).
- **ClientRequest timeout option**: `http.request({timeout: 50})` starts a timer that emits `'timeout'` if no response arrives in time. Timer cleared on response or abort.

**Net Socket improvements:**
- **allowHalfOpen enforcement**: `net.Server({allowHalfOpen})` now stores and passes the option to accepted sockets. When `allowHalfOpen=false` (default), the socket calls `end()` on read EOF, matching Node.js behavior.
- **Socket allowHalfOpen property**: `net.Socket` exposes `allowHalfOpen` as a public property and respects it during EOF handling in the read loop.

**New tests (+200):**
- HTTP: 890→995 (+105): ServerResponse.setTimeout, IncomingMessage.setTimeout, ClientRequest.setTimeout/timeout option, abort events, HEAD no-body, automatic headers, custom status messages, res.end() callback, multiple headers (Set-Cookie), flushHeaders, POST body streaming (empty/64KB), error handling (EADDRINUSE, connection refused), server lifecycle
- Net: 295→361 (+66): Socket.setTimeout (idle timeout, data resets, cancellation), allowHalfOpen enforcement, server lifecycle (listening, close, address, getConnections), connection lifecycle (connect/ready events, connecting state, bytesRead/bytesWritten), destroy/close events, error handling (connection refused, EADDRINUSE), setKeepAlive/setNoDelay chainability, maxConnections, echo/binary data
- Stream: 288→330 (+42): pipeline (error propagation from source/transform/sink, callback behavior), finished (writable/readable/error/premature close, cleanup), Transform _flush (data push, error propagation), Readable.from (array/generator/async generator/string/Buffer), addAbortSignal (abort/already-aborted), backpressure (write returns false, drain events), PassThrough, Duplex read+write, objectMode, async iteration with errors

### 2026-03-26 — Fetch Globals, WebSocket Server, EADDRINUSE Fix, GTK Dashboard

**Infrastructure fixes:**
- **Fetch API globals on GJS**: `@gjsify/fetch` now registers `fetch`, `Request`, `Response`, `Headers` on `globalThis`. `@gjsify/node-globals` imports `@gjsify/fetch` for side-effect registration (replaces empty stubs).
- **EADDRINUSE error on GJS**: `http.Server.listen()` now throws when port is busy and no `'error'` listener is registered, matching Node.js behavior (previously exited silently).
- **WebSocket server**: `http.Server.addWebSocketHandler(path, callback)` delegates to `Soup.Server.add_websocket_handler()` for server-side WebSocket on GJS.

**New examples:**
- `examples/net/ws-chat`: WebSocket chat using `Soup.WebsocketConnection` signals, with REST POST fallback
- `examples/gtk/http-dashboard`: GTK4 window + embedded HTTP server. Labels show request count/uptime, TextView shows request log. Uses `GLib.idle_add()` for thread-safe UI updates.

### 2026-03-26 — Real-World Examples Sprint (+6 examples, +116 tests)

**New examples (all work on both Node.js and GJS unless noted):**
- `examples/net/static-file-server`: `createReadStream().pipe(res)`, MIME types, gzip, directory listing, 304 caching
- `examples/net/sse-chat`: Real-time chat via Server-Sent Events + HTTP POST, EventEmitter message bus
- `examples/net/hono-rest`: Hono.js CRUD REST API with JSON validation (Node.js works, GJS needs Fetch API globals)
- `examples/cli/file-search`: Recursive file search using `createReadStream` + `readline.createInterface`
- `examples/cli/dns-lookup`: Interactive DNS tool using `dns.lookup/resolve4/resolve6/reverse`
- `examples/cli/worker-pool`: Task pool with MessageChannel for inter-worker communication

**New tests:**
- HTTP streaming (65 tests): `Readable.pipe(res)`, multi-chunk writes, large bodies (256KB), POST body, concurrent requests, routing, server lifecycle
- fs streams (27 tests): `createReadStream`/`createWriteStream`, pipe (ReadStream→WriteStream, Transform, PassThrough), Unicode, binary
- net TCP (24 tests): echo server, 64KB data transfer, connection events, socket properties, UTF-8/binary, error handling

**Validated:** `createReadStream().pipe(res)` works on GJS. TCP echo and data transfer work cross-platform. MessageChannel postMessage works for task distribution.

### 2026-03-26 — Static File Server Example

**New example:**
- `examples/net/static-file-server`: Static file server with `fs.createReadStream().pipe(res)`, MIME type detection, gzip compression (`zlib.gzipSync`), directory listing, `If-Modified-Since`/304, directory traversal prevention. Runs on both Node.js and GJS.

**Validated:** `createReadStream().pipe(res)` works correctly on GJS — the stream pipe mechanism (Readable→Writable with backpressure) and Soup.Server response buffering are fully compatible.

### 2026-03-26 — Real-World Application Examples & GJS Compat Fixes

**New examples:**
- `examples/net/koa-blog`: Koa.js blog with EJS templates, HTML forms, JSON API, CRUD. Runs on both Node.js and GJS.
- `examples/net/express-hello`: Updated to use `@gjsify/runtime` for platform detection.

**New packages:**
- `@gjsify/runtime`: Platform-independent runtime detection (isGJS, isNode, runtimeName, runtimeVersion). No dependencies, works on both platforms.

**GJS compatibility fixes surfaced by real-world frameworks:**
- **http.Server GC guard**: Koa/Express create http.Server inside `.listen()` and discard the return value. GJS GC collected the server after ~10s of inactivity. Fix: module-level `Set<Server>` keeps strong references to all listening servers.
- **http.Server connection exhaustion**: Soup.Server keeps HTTP/1.1 connections alive by default. After ~10 requests, connection pool was full. Fix: set `Connection: close` header, always call `set_response()` even for empty bodies (redirects, 204s).
- **assert cjs-compat.cjs**: Koa's `require('assert')` got a namespace object instead of the assert function. Added CJS compatibility wrapper.
- **Web API stubs**: Registered `Response`, `Request`, `Headers`, `ReadableStream`, `Blob` as empty global classes on GJS. Prevents `ReferenceError` in frameworks using `val instanceof Response`.
- **StringDecoder function constructor**: Converted from ES6 class to function constructor. `iconv-lite` (used by `koa-bodyparser`) calls `StringDecoder.call(this, enc)` which fails on ES6 classes.
- **skipLibCheck for TS6**: Added to all example and `@gjsify/unit` tsconfigs. `@types/node@25.5.0` has `export = console` pattern incompatible with TypeScript 6's `module: NodeNext`.

### 2026-03-25 — Comprehensive Improvement Sprint (3,260→8,100 tests)

**Phase 1 — Test pipeline stabilization:**
- Fixed test failures in perf_hooks, process, readline, tty, fetch, formdata, stream, url
- Stabilized cross-platform test execution for consistent Node.js and GJS results

**Phase 2 — Test expansion (path, url, diagnostics_channel, zlib):**
- path: 51→135 (parse, format, normalize, resolve, relative, isAbsolute, POSIX + Win32 edge cases)
- url: 82→278 (URL constructor, searchParams, edge cases, legacy url.parse/format/resolve)
- diagnostics_channel: 26→137 (Channel lifecycle, subscribe/unsubscribe, TracingChannel, hasSubscribers)
- zlib: expanded sync/async methods, double compression, consistency tests

**Phase 3 — fs and os implementation fixes:**
- fs: Dirent methods (isFile/isDirectory/isSymbolicLink), FSWatcher persistent option, mkdirSync recursive return value, async rmdir/unlink, proper ENOENT/EACCES error codes
- os: Fixed TODO items in implementation

**Phase 4 — Test expansion (http, vm, worker_threads):**
- http: 136→457 (STATUS_CODES completeness, IncomingMessage/ServerResponse properties, Agent lifecycle, request options, chunked encoding, error handling)
- vm: 49→203 (runInThisContext edge cases, runInNewContext sandbox isolation, Script reuse, compileFunction params, createContext/isContext, error propagation)
- worker_threads: 93→217 (MessageChannel ordering, MessagePort lifecycle, BroadcastChannel multi-receiver, Worker IPC, structured clone completeness, environmentData)

**Phase 5 — Web API expansion (web-streams, webcrypto + impl fixes):**
- web-streams: 139→283 (ReadableStream tee/pipeTo/pipeThrough, WritableStream abort/close, TransformStream backpressure, TextEncoderStream/TextDecoderStream edge cases, queuing strategies)
- webcrypto: 190→486 (digest all algorithms, AES-CBC/CTR/GCM round-trip, HMAC sign/verify, ECDSA/RSA-PSS/RSA-OAEP, PBKDF2/HKDF/ECDH derivation, generateKey/importKey/exportKey completeness, CryptoKey properties)
- webcrypto impl fixes for GJS compatibility

**Total: 3,260→8,100 test cases. 83 spec files. All pass on both Node.js and GJS.**

### 2026-03-25 — Test Expansion Sprint (+720 tests)

**Phase 1 — Underserved packages (8 packages, +442 tests):**
- readline: 24→130 (line events, mixed endings, Unicode, history, async iterator, CSI utilities)
- https: 24→62 (Agent options, globalAgent, request/get methods, createServer/Server)
- tty: 23→29 (isatty, ReadStream/WriteStream prototype, getColorDepth env)
- module: 27→158 (builtinModules completeness, isBuiltin edge cases, createRequire)
- async_hooks: 28→74 (enterWith, snapshot, exit with args, triggerAsyncId option)
- process: 37→75 (env CRUD, pid/ppid, hrtime ordering, memoryUsage, nextTick, cpuUsage)
- os: 32→62 (type/platform/arch validation, constants signals/errno, userInfo, networkInterfaces)
- console: 37→84 (format specifiers, table, dir, time/timeLog, Console stdout/stderr routing)

**Phase 2 — Core packages (2 packages, +167 tests):**
- events: 60→127 (setMaxListeners, errorMonitor, captureRejections, prependListener, rawListeners, Symbol events, async iterator)
- buffer: 52→152 (encodings, TypedArray/ArrayBuffer, fill, indexOf/lastIndexOf, swap16/32/64, int/float read/write, equals)

**Phase 3 — Coverage gaps (3 packages, +111 tests):**
- dgram: 37→80 (socket methods, broadcast/TTL/multicast, ref/unref, IPv6, connect/disconnect, I/O)
- fs/promises: 30→59 (writeFile/readFile round-trip, mkdir/rmdir, stat, rename, copyFile, chmod, mkdtemp, truncate)
- perf_hooks: 31→70 (mark/measure lifecycle, getEntries filtering, clearMarks/Measures, toJSON, exports)

**Implementation fixes:**
- `async_hooks`: Fixed AsyncResource.asyncId() to return stable per-instance id; added snapshot(), exit() with args, triggerAsyncId option
- `os`: Fixed trailing newline from cli() output in type()/platform()/release()
- `buffer`: Fixed lastIndexOf with undefined byteOffset on SpiderMonkey (was searching from index 0)
- `module`: Added async_hooks to builtinModules list

### 2026-03-25 — Coverage & Stability Sprint (Day 7–10)

**New API implementations:**
- `tls`: Added `checkServerIdentity()` (wildcard certs, SAN, FQDN/trailing-dot), `getCiphers()`, `DEFAULT_CIPHERS` (18 new tests)
- `dgram`: Added `Socket.connect()`, `Socket.disconnect()`, `Socket.remoteAddress()` with ERR_SOCKET_DGRAM_IS_CONNECTED / NOT_CONNECTED / BAD_PORT error handling (7 new tests)
- `worker_threads`: Added `MessagePort.addEventListener()` / `removeEventListener()` and `BroadcastChannel.addEventListener()` / `removeEventListener()` (9 new tests)
- `fs/FileHandle`: Implemented `read()` (Gio.FileInputStream-based), `truncate()` (Gio.File overlay), `writeFile()` (Gio.File), `stat()` (Stats constructor). Fixed `open()` error mapping for GLib.FileError (ENOENT vs ENOTDIR). Fixed `readlinkSync` error re-throw guard (numeric vs string code). Fixed `read()` `...args` rest param bug (previously parsed buffer bytes as args).

**Test additions:**
- `fs`: 126 → 153 (+27): FileHandle read/write/truncate/writeFile/stat/readFile/appendFile, error cases for non-existent paths, symlink edge cases
- `tls`: 30 → 48 (+18): checkServerIdentity (wildcards, SANs, FQDN, IP), getCiphers, DEFAULT_CIPHERS constant
- `dgram`: 30 → 37 (+7): connect/disconnect/remoteAddress, error codes
- `worker_threads`: 41 → 50 (+9): addEventListener/removeEventListener, structured clone edge cases (-0, NaN, BigInt, Int32Array)

**Bug fixes:**
- `tls.checkServerIdentity`: Wildcard pattern `unfqdn()` normalization for trailing-dot FQDNs (GJS test was failing)
- `tls` test: `toContain()` does not check string substrings in `@gjsify/unit` (only array containment); replaced with `toMatch(/.../)`
- `readlinkSync`: Catch block `if ((err as {code?}).code) throw err` re-threw Gio errors with numeric code (1) before `createNodeError` conversion; fixed to check `typeof === 'string'`
- `FileHandle.open()`: GLib.IOChannel.new_file() throws GLib.FileError (code 4 = NOENT) which overlaps with Gio.IOErrorEnum (code 4 = NOT_DIRECTORY); added `GLIB_FILE_ERROR_TO_NODE` mapping in constructor
- `FileHandle.write()`: Switched to Gio.File overlay (read-modify-write) so data is immediately on-disk and visible to subsequent `read()` calls (GLib.IOChannel flush does not call fflush on stdio FILE* buffer)

**Total: 2,503 → 2,540 test cases. All pass on both Node.js and GJS.**

---

### 2026-03-25 — Metric Consolidation (Coverage Audit)

**Corrected test counts to match actual spec files (no implementation changes):**
- `net`: 64 → 84 (TCP lifecycle, error handling, large data, simultaneous connections)
- `fs`: 83 (7 specs) → 126 (8 specs) — added symlink.spec.ts, expanded extended/new-apis/file-handle
- `stream`: 141 (3 specs) → 196 — expanded Readable/Writable/Transform/backpressure/objectMode tests
- `child_process`: 43 → 79 — expanded execFile, spawn, env, cwd, edge cases
- `html-image-element`: 2 → 22 — full attribute coverage (alt, src, width, height, crossOrigin, loading, decode)
- Added `@gjsify/dom-elements` to Web API table (was missing): 61 tests, Node/Element/HTMLElement hierarchy
- Total test cases: 2,130 → 2,503 | Spec files: 75 → 83 | Web APIs: 14 → 15

### 2026-03-25 — Stabilization & Deduplication

**Fixed worker_threads GJS timeouts (17 tests → 0 failures):**
- Added `@gjsify/node-globals` import to test.mts (registers structuredClone on GJS)
- Replaced `setTimeout(..., 0)` with `Promise.resolve().then()` in MessagePort._dispatchMessage() and BroadcastChannel.postMessage() for correct microtask scheduling on GLib main loop
- worker_threads tests: 63 → 82 (all pass on both Node.js and GJS)

**Extracted shared base64 utilities to `@gjsify/utils/src/base64.ts`:**
- Consolidated duplicate base64 encode/decode from `@gjsify/buffer` (58 lines) and `@gjsify/string_decoder` (16 lines)
- Exports: `base64Encode`, `base64Decode`, `atobPolyfill`, `btoaPolyfill`
- Both consumer packages now import from `@gjsify/utils` — no behavioral change

**Extracted shared nextTick utility to `@gjsify/utils/src/next-tick.ts`:**
- Consolidated duplicate microtask scheduling (process.nextTick → queueMicrotask → Promise fallback)
- `@gjsify/stream` now imports `nextTick` from `@gjsify/utils` (was inline 6-line definition)

**Expanded test coverage:**
- fetch tests: 24 → 51 (Headers forEach/values, Request clone/redirect/signal/null-body, Response.json/clone/statusText/type/headers)
- vm tests: 22 → 49 (SyntaxError/ReferenceError propagation, object literals, nested sandbox objects, Script invalid code, multi-context reuse)
- Total test cases: ~2,960 → ~3,030

### 2026-03-25 — structuredClone Polyfill

**Replaced JSON round-trip polyfill with full HTML structured clone algorithm:**
- New `packages/gjs/utils/src/structured-clone.ts` implementing spec-compliant structuredClone
- Supports: primitives (-0, NaN, BigInt), wrapper objects, Date, RegExp, Error types (with cause), ArrayBuffer, all TypedArrays, DataView, Map, Set, Blob, File, circular/shared references
- Throws DataCloneError for functions, symbols, WeakMap, WeakSet, WeakRef
- Removed duplicated `deepClone`/`cloneValue` from worker_threads (now uses global structuredClone)
- Added `refs/ungap-structured-clone/` as reference submodule
- globals tests: 40 → 96 (56 new structuredClone tests ported from WPT and node-test)
- All 221 tests pass on both Node.js and GJS

### 2026-03-25 — Phase 20: worker_threads + vm Enhancement

**worker_threads structured clone improvements:**
- Replaced JSON round-trip fallback with proper deep clone supporting: Date, RegExp, Map, Set, Error, ArrayBuffer, TypedArrays, nested objects, circular reference detection
- 7 new structured clone tests (Date, RegExp, Map, Set, Error, Uint8Array, nested complex types)
- worker_threads tests: 56 → 63

**vm promoted from Stub to Partial:**
- `runInNewContext(code, sandbox)`: Evaluates code with sandbox variables injected via Function constructor
- `runInContext(code, context)`: Delegates to runInNewContext for created contexts
- `createContext(context)`: Marks objects with Symbol for isContext() detection
- `isContext(context)`: Checks for createContext marker
- `compileFunction(code, params)`: Compiles source code into a reusable Function
- `Script.runInNewContext(context)`: Run compiled script with sandbox
- `Script.runInContext(context)`: Run compiled script in created context
- `Script.createCachedData()`: Returns empty Uint8Array (stub)
- 22 tests (was 6): exports, runInThisContext (arithmetic, strings, complex), runInNewContext (sandbox variables, strings, empty context, arrays), createContext/isContext, compileFunction (no params, with params, string return), Script (constructable, runInThisContext, runInNewContext, runInContext, reusable, createCachedData)

### 2026-03-25 — Phase 19: WebCrypto Algorithm Completion

**New crypto primitives:**
- **ECDSA sign/verify** (`crypto/src/ecdsa.ts`): Full FIPS 186-4 implementation with RFC 6979 deterministic k generation via HMAC-DRBG. Supports P-256, P-384, P-521 curves with SHA-1/256/384/512. Signature format: raw r||s concatenation.
- **MGF1** (`crypto/src/mgf1.ts`): Mask Generation Function 1 per RFC 8017 Section B.2.1. Foundation for RSA-PSS and RSA-OAEP.
- **RSA-PSS sign/verify** (`crypto/src/rsa-pss.ts`): EMSA-PSS-ENCODE/VERIFY per RFC 8017 Section 9.1. Configurable salt length.
- **RSA-OAEP encrypt/decrypt** (`crypto/src/rsa-oaep.ts`): RSAES-OAEP-ENCRYPT/DECRYPT per RFC 8017 Section 7.1. Optional label support.

**SubtleCrypto extensions:**
- `sign()`: Added ECDSA and RSA-PSS algorithm routing
- `verify()`: Added ECDSA and RSA-PSS algorithm routing
- `encrypt()`: Added RSA-OAEP algorithm routing
- `decrypt()`: Added RSA-OAEP algorithm routing

**6 new ECDSA tests**: key generation (P-256), sign/verify round-trip (P-256 SHA-256), corrupted signature rejection, wrong data rejection, different messages produce different signatures, P-384 sign/verify

### 2026-03-25 — Phase 18: Web-Layer-Refactoring + Unified Web-Globals

**18a: DOMException extracted to own package:**
- New package `@gjsify/dom-exception` — DOMException polyfill per WebIDL standard
- Extracted from `@gjsify/dom-events` (was mixed with DOM Events, but DOMException is WebIDL, not DOM Events)
- `@gjsify/dom-events` now re-exports DOMException from `@gjsify/dom-exception` (backwards compatible)
- Registers `globalThis.DOMException` on GJS if missing

**18b: Unified web-globals package:**
- Redesigned `@gjsify/web-globals` from 2-line side-effect import to unified entry point
- Single `import '@gjsify/web-globals'` registers all Web API globals on GJS:
  - DOMException, Event, EventTarget, CustomEvent (dom-exception + dom-events)
  - AbortController, AbortSignal (abort-controller)
  - ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream (web-streams)
  - CompressionStream, DecompressionStream (compression-streams)
  - crypto.subtle, getRandomValues, randomUUID (webcrypto)
  - EventSource (eventsource)
- Re-exports key types for programmatic use
- **27 tests**: DOMException (constructable, error codes, instanceof), DOM Events (Event, EventTarget dispatch), AbortController (signal, abort), Web Streams (Readable/Writable/Transform constructable), Encoding Streams, Compression Streams, WebCrypto (subtle, getRandomValues, randomUUID), EventSource import

### 2026-03-25 — Phase 17: fs + Stream Submodule Test Expansion

**fs callback test expansion** (1 → 15 tests):
- stat/lstat: directory stat, ENOENT error
- readdir: list files
- mkdir/rmdir: create and remove directory
- writeFile/readFile: string and Buffer data, ENOENT error
- open/write/close: low-level file I/O
- access: F_OK success and ENOENT failure
- appendFile: append content
- rename: file rename round-trip
- copyFile: file copy round-trip
- truncate: truncate file content
- chmod: change file mode

**stream submodule tests** (new 2 spec files):
- **stream/consumers** (12 tests): text (empty, single, multi-chunk), json (object, array, number), buffer (data, empty), arrayBuffer (single, multi-chunk), blob (data, content verification)
- **stream/promises** (8 tests): pipeline (readable→writable, through transform, PassThrough, source error rejection), finished (writable finish, readable end, error rejection, already-finished)

### 2026-03-24 — Phase 16: Networking Test Expansion + Housekeeping

**Housekeeping:**
- Committed pending eventsource GJS compatibility changes (Event/EventTarget polyfill fallbacks, runtime deps)
- Committed TextDecoderStream GJS fallback (manual UTF-8 buffering for missing `stream` option)
- Cleaned up STATUS.md priorities (removed duplicate WebCrypto entry, reordered by impact)

**Networking test expansion:**
- **net** (35 → 64 tests): isIP edge cases (full/compressed IPv6, zone IDs, IPv4-mapped, malformed, non-string input), Socket properties (pending, readyState, destroy, address), TCP connection lifecycle (connect state transitions, localAddress/localPort, bytesRead/bytesWritten, setEncoding, setTimeout, getConnections, remoteFamily, connection event, multi-byte UTF-8 echo, large data transfer, server address family)
- **dgram** (20 → 30 tests): Multiple sends, UDP echo round-trip, rinfo.size, Socket as EventEmitter, ipv6Only option

### 2026-03-24 — Phase 15: Test Coverage Expansion

**Stream package** test expansion (66 → 87 tests):
- Writable backpressure: HWM threshold, drain event, writableLength, writableEnded/Finished state tracking
- ObjectMode: Transform with objects, Readable objectMode, readableObjectMode property
- Destroy behavior: idempotent destroy, error emission, close events on both Readable and Writable
- Pipe error handling: unpipe stops data flow, error isolation between piped streams

### 2026-03-24 — Phase 14: EventSource (Server-Sent Events)

**New package `@gjsify/eventsource`** — W3C EventSource (Server-Sent Events):

- **EventSource** class extending EventTarget with CONNECTING/OPEN/CLOSED states
- **TextLineStream** utility: TransformStream splitting stream into lines (\n, \r\n, standalone \r)
- SSE field parsing: event, data, id, retry fields per HTML spec
- Multi-line data support (multiple `data:` fields concatenated with \n)
- Comment filtering (lines starting with `:`)
- Auto-reconnection with configurable retry delay, new AbortController per attempt
- `onopen`/`onmessage`/`onerror` attribute handlers + addEventListener support
- `lastEventId` tracking via `id:` field
- Global registration on GJS
- **24 tests**: 4 TextLineStream + 11 unit tests + 9 SSE integration tests (real HTTP server)

### 2026-03-24 — Phase 13: WebCrypto (crypto.subtle)

**New package `@gjsify/webcrypto`** — W3C WebCrypto API for GJS:

- **SubtleCrypto** class with all major methods:
  - `digest`: SHA-1, SHA-256, SHA-384, SHA-512 (wraps @gjsify/crypto Hash/GLib.Checksum)
  - `encrypt`/`decrypt`: AES-CBC, AES-CTR, AES-GCM (wraps @gjsify/crypto cipher.ts)
  - `sign`/`verify`: HMAC (wraps @gjsify/crypto hmac.ts)
  - `generateKey`: AES (128/192/256), HMAC, ECDH (P-256/P-384/P-521), ECDSA key pairs
  - `importKey`/`exportKey`: raw, jwk formats for symmetric + EC keys
  - `deriveBits`/`deriveKey`: PBKDF2, HKDF, ECDH
- **CryptoKey** class with type/extractable/algorithm/usages + frozen properties
- **Crypto** polyfill: `getRandomValues()`, `randomUUID()`, `subtle`
- Native passthrough on Node.js (uses globalThis.crypto.subtle), polyfill on GJS
- Global `crypto` registration on GJS
- **37 tests**: digest, generateKey, importKey/exportKey round-trip, AES encrypt/decrypt (CBC/CTR/GCM with AAD), HMAC sign/verify, PBKDF2/HKDF deriveBits, ECDH shared secret, deriveKey, CryptoKey properties, getRandomValues, randomUUID

### 2026-03-24 — Phase 12: TextEncoderStream / TextDecoderStream

**Added to `@gjsify/web-streams`** — WHATWG Encoding Streams:

- **TextEncoderStream**: Encodes string chunks to UTF-8 Uint8Array via TransformStream. Handles surrogate pairs split across chunks (buffers pending high surrogates, emits U+FFFD for unpaired surrogates at stream end). Reference: `refs/deno/ext/web/08_text_encoding.js`.
- **TextDecoderStream**: Decodes byte chunks to strings via TransformStream wrapping `TextDecoder` with `stream: true`. Supports `encoding`, `fatal`, `ignoreBOM` options. Handles multi-byte UTF-8 sequences split across chunks.
- **Global registration**: On GJS, registers `TextEncoderStream` and `TextDecoderStream` as globals (not natively available in GJS 1.86).
- **Re-exports**: Available via `stream/web` module (same as `@gjsify/web-streams`).
- **22 new tests** (117 total for web-streams): Constructor, encoding properties, ASCII/multi-byte/4-byte encode/decode, empty chunks, surrogate pair split, unpaired surrogate replacement, ArrayBuffer input, round-trip (ASCII, Unicode, split surrogates).
- All 117 tests pass on Node.js 24. Foundation for Phase 14 (EventSource).

### 2026-03-24 — Phase 11: WHATWG Web Streams API (@gjsify/web-streams)

**New package `@gjsify/web-streams`** — complete WHATWG Streams polyfill for GJS, ported from `refs/node/lib/internal/webstreams/` (pure TypeScript, no native bindings):

- **WritableStream** (Phase 1): WritableStream, WritableStreamDefaultWriter, WritableStreamDefaultController, backpressure, abort/close lifecycle
- **ReadableStream** (Phase 2): ReadableStream, ReadableStreamDefaultReader, ReadableStreamDefaultController, tee, pipeTo, pipeThrough, async iteration, `ReadableStream.from()` (iterables/async iterables)
- **TransformStream** (Phase 3): TransformStream, TransformStreamDefaultController, backpressure coordination, flush/cancel
- **Queuing strategies**: ByteLengthQueuingStrategy, CountQueuingStrategy
- **Consumer integration** (Phase 4): `stream/web` re-exports from `@gjsify/web-streams`, `compression-streams` uses real TransformStream (SimpleReadable/SimpleWritable shims removed)
- **Global registration**: On GJS, registers ReadableStream/WritableStream/TransformStream as globals
- **95 tests** pass on both Node.js 24 and GJS 1.86
- BYOB/byte streams deferred (Phase 5, optional)

### 2026-03-24 — Phase 10: Promote 4 packages to Full, add 2 Web API packages

**Promoted http, crypto, tls, https from Partial → Full (27 → 31 Full, 69% → 79%):**

- **http** (93 → 136 tests): Added `OutgoingMessage` base class, `setMaxIdleHTTPParsers` stub. API surface now matches Node.js http module. Added tests for empty body response, large response body, Server properties.
- **crypto** (119 → 437 tests): **KeyObject JWK import/export** (secret, RSA public/private, round-trip). **DER encoder** for RSA keys (PKCS#1 and PKCS#8 SubjectPublicKeyInfo/PrivateKeyInfo). **Derived public key** now exports valid PEM (was `[derived-public-key]` marker). **X509Certificate class** — full ASN.1 X.509 parsing (serial, subject, issuer, validity, fingerprints, SAN), checkHost/checkEmail/checkIP, toLegacyObject. Added `x509.spec.ts` with 18 tests.
- **tls** (19 → 36 tests): **Client TLS handshake** — `connect()` now wraps TCP `Gio.SocketConnection` with `Gio.TlsClientConnection`, performs async handshake, emits `secureConnect`. **Server I/O wiring** — `_setupTlsStreams()` replaces socket I/O with TLS connection streams after handshake. **ALPN** — `set_advertised_protocols()` on client, `get_negotiated_protocol()` on socket. Certificate validation via `accept-certificate` signal.
- **https** (17 → 32 tests): Confirmed functional — Soup.Session handles HTTPS natively for client requests.

**New Web API packages (7 → 10):**

- **@gjsify/compression-streams** (25 tests): W3C CompressionStream/DecompressionStream (gzip, deflate, deflate-raw). Uses native on Node.js. GJS polyfill blocked on Web Streams API availability.
- **@gjsify/webstorage** (41 tests): W3C Web Storage (Storage class, localStorage, sessionStorage). In-memory implementation, works on both Node.js and GJS. setItem/getItem/removeItem/clear/key, Unicode support.

**Key discovery:** GJS 1.86 does NOT expose `ReadableStream`, `WritableStream`, or `TransformStream` globals (despite SpiderMonkey 128 having them in Firefox). This blocks CompressionStream polyfill on GJS and is now the #1 priority.

### 2026-03-24 — Phase 9: Fix worker_threads, zlib, string_decoder for CI

- **worker_threads**: Fixed `structuredClone` unavailability in GJS by adding `cloneValue()` fallback (JSON round-trip). Switched message dispatch from `Promise.resolve().then()` to `setTimeout(fn, 0)` for GLib main loop integration. All 56 tests pass on GJS.
- **zlib**: Implemented sync methods (`gzipSync`, `gunzipSync`, `deflateSync`, `inflateSync`, `deflateRawSync`, `inflateRawSync`) using `Gio.ZlibCompressor`/`Gio.ZlibDecompressor`. Replaced legacy `imports.gi` access with proper `@girs/*` imports. All 340 tests pass on both platforms.
- **string_decoder**: Replaced `TextDecoder` dependency with pure manual UTF-8 decoder implementing W3C maximal subpart algorithm. Fixes `F0 B8 41` handling on GJS 1.80 (SpiderMonkey 115) where `TextDecoder` produces incorrect replacement character count.

### 2026-03-24 — Phase 8: http2 — From Stub to Partial

**Promoted http2 from Stub → Partial** with complete constants, settings functions, and class stubs:

- **Complete constants** (200+ entries): All NGHTTP2 error codes (RFC 7540 §7), session types, stream states, frame flags, settings IDs, default settings values, frame size constraints, padding strategies, HTTP/2 pseudo-headers, 70+ standard HTTP headers, 40+ HTTP methods, 60+ HTTP status codes
- **Settings functions**: `getDefaultSettings()` returns RFC 7540 defaults, `getPackedSettings()` / `getUnpackedSettings()` implement binary SETTINGS frame encoding (6-byte pairs: 2-byte ID + 4-byte value, big-endian)
- **Class stubs** (EventEmitter-based): `Http2Session` (localSettings/remoteSettings, settings/goaway/ping/close/destroy), `Http2Stream` (state machine, close/destroy/priority), `ServerHttp2Session`, `ClientHttp2Session`, `ServerHttp2Stream`, `ClientHttp2Stream`, `Http2ServerRequest` (headers/method/url/authority/scheme), `Http2ServerResponse` (setHeader/getHeader/writeHead/write/end)
- **102 tests** (was 5): constants (error codes, session types, stream states, settings IDs, default values, frame flags, pseudo-headers, HTTP headers/methods/status codes, frame size constraints), getDefaultSettings properties, getPackedSettings/getUnpackedSettings round-trip, sensitiveHeaders, factory functions, class exports
- All 102 tests pass on both Node.js 24 and GJS 1.86

**Soup 3.0 HTTP/2 findings**: Soup can negotiate HTTP/2 via ALPN but treats it as transparent — no multiplexed stream API. Full createServer/connect would require nghttp2 bindings (Vala extension) or a pure-JS HTTP/2 frame parser.

### 2026-03-24 — Phase 7: worker_threads — From Stub to Partial

**Promoted worker_threads from Stub → Partial** with full MessageChannel/MessagePort/BroadcastChannel implementation and subprocess-based Worker prototype:

- **MessagePort** (EventEmitter-based): `postMessage` with `structuredClone`, auto-start on `on('message')`, message queue for pre-start delivery, `close()` with cleanup, `ref()`/`unref()` stubs
- **MessageChannel**: Creates paired MessagePorts for bidirectional communication
- **BroadcastChannel** (W3C API): Global registry by name, `onmessage` property, `addEventListener`/`removeEventListener`, `close()` with registry cleanup, no self-delivery
- **Worker** (Gio.Subprocess): Spawns `gjs` child process with embedded bootstrap script, stdin/stdout IPC (newline-delimited JSON), `postMessage`/`on('message')`/`terminate()`, `eval: true` mode, environment variable passthrough
- **Worker context detection**: `globalThis.__gjsify_worker_context` flag lets bundled worker scripts import correct `parentPort`/`workerData`/`threadId` from `worker_threads`
- **Utility functions**: `receiveMessageOnPort` (synchronous dequeue), `getEnvironmentData`/`setEnvironmentData`, `markAsUntransferable`, `markAsUncloneable`, `moveMessagePortToContext`
- **56 tests** (was 6): exports, MessageChannel message delivery (string/object/multi/order), clone verification, MessagePort auto-start/close/once, receiveMessageOnPort (empty/sync/dequeue), BroadcastChannel (same-name/self/different-name/closed/multi-receiver), environmentData CRUD, utility functions
- All 56 tests pass on both Node.js 24 and GJS 1.86

**Research findings documented:**
- GJS intentionally blocks `GLib.Thread.new()` (throws "Use GIO async methods or Promise()")
- SpiderMonkey JSContext is thread-bound — no parallel JS execution possible in-process
- Subprocess-based approach (Ansatz A) is the only viable path for true parallelism
- Vala extension approach (Ansatz B) would require wrapping `gjs_context_new()` — unstable API
- libpeas (Ansatz C) is designed for plugins, not worker pools

### 2026-03-24 — Phases 1–5: Major Feature Implementation

**Phase 1 — HTTP client round-trip on GJS:**
- Fixed ClientRequest to buffer response body before emitting 'response' (race condition fix)
- Fixed ServerResponse double 'finish' emission
- Fixed stream nextTick to prefer queueMicrotask
- All 93 HTTP tests now pass on GJS (6 round-trip tests: GET, POST, headers, 404, etc.)

**Phase 2 — WebSocket Web API:**
- New package `@gjsify/websocket` using Soup 3.0 WebsocketConnection
- W3C spec: WebSocket, MessageEvent, CloseEvent, text + binary support
- 27 tests including 3 round-trip tests with echo server

**Phase 3 — Crypto DH/ECDH/AES-GCM:**
- DiffieHellman: BigInt-based, RFC 2409/3526 groups (modp1–modp18)
- ECDH: Pure TypeScript elliptic curve arithmetic (secp256k1, P-256, P-384, P-521)
- AES-GCM: GHASH authentication in GF(2^128), AAD support
- 30 new tests

**Phase 4 — Crypto Sign/Verify/RSA:**
- ASN.1/DER/PEM parser for RSA keys (PKCS#1 and PKCS#8)
- createSign/createVerify: RSA PKCS#1 v1.5 signatures
- publicEncrypt/privateDecrypt: RSA encryption
- 11 new tests

**Phase 5 — TLS server, fs async, STATUS.md updates**

### 2026-03-23 — Phase 0: Housekeeping

- Reclassified **globals** from Partial → Full (40 tests, all essential globals implemented)
- Reclassified **readline** from Partial → Full (50 tests, Interface/createInterface/question/prompt/async-iterator)
- Updated CLAUDE.md: dgram from Stub → Full (was already correct in STATUS.md)
- Updated metrics: 27 fully implemented (69%), 4 partial (10%), 8 stubs (21%)

### 2026-03-23 — Wave 8

**Remaining packages — expand tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| globals | 15 | 96 | process (platform/argv/pid), Buffer (alloc/isBuffer), structuredClone (full polyfill: Date, RegExp, Error, TypedArrays, Map, Set, circular refs, DataCloneError), TextEncoder/Decoder, atob/btoa, URL/URLSearchParams, console |
| child_process | 26 | 35 | execFile error, spawnSync env, exports validation, edge cases |

### 2026-03-23 — Wave 7

**Networking completion — HTTPS & TLS tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| https | 2 | 17 | Agent (defaultPort/protocol), request/get wrapper, exports, globalAgent |
| tls | 2 | 19 | TLSSocket API (encrypted, getPeerCert, getProtocol, getCipher), createSecureContext, constants |

### 2026-03-23 — Wave 6

**Crypto expansion — implementation + tests:**

| Package | Component | Tests | Description |
|---------|-----------|-------|-------------|
| crypto | Cipher/Decipher | +25 | Pure-JS AES (FIPS-197): CBC, CTR, ECB; PKCS#7 padding; NIST test vectors |
| crypto | scrypt | +11 | RFC 7914 (Salsa20/8 + BlockMix + ROMix); sync + async; RFC test vectors |

**New implementations:**
- **cipher.ts:** Complete AES-128/192/256 implementation in pure TypeScript. S-Box, InvS-Box, KeyExpansion, MixColumns, ShiftRows. Modes: CBC (with IV chaining), CTR (stream cipher), ECB (no IV). PKCS#7 padding with setAutoPadding().
- **scrypt.ts:** RFC 7914 scrypt in pure TypeScript. Uses Salsa20/8 Core, BlockMix, ROMix. Internally uses pbkdf2Sync (already available).

### 2026-03-23 — Wave 5

**Networking foundation — tests + implementation polish:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| net | 8 | 35 | isIP/isIPv4/isIPv6 complete, Socket/Server API, TCP echo/multi-connect (Node.js) |
| dgram | 10 | 20 | createSocket options, bind, UDP send/receive round-trip (Node.js) |
| http | 24 | 42 (2 specs) | STATUS_CODES/METHODS, Agent, Server round-trip (GET/POST/404/Headers, Node.js) |

### 2026-03-23 — Wave 4

**Test expansions (quick wins for already implemented packages):**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| dns | 3 | 50 (2 specs) | Constants, lookup options (family/all), resolve4/6, reverse, dns/promises complete |
| timers | 28 | 43 (2 specs) | Ordering, negative delays, nested timers, refresh, setInterval with AbortController |
| zlib | 15 | 27 | Unicode, binary, large data, constants, cross-format errors, gzip magic bytes |
| module | 14 | 21 | createRequire, builtinModules validation, isBuiltin with subpaths/prefixes |
| tty | 14 | 23 | isatty with various fds, ReadStream/WriteStream properties |
| perf_hooks | 18 | 30 | mark/measure/getEntries, clearMarks, toJSON, timeOrigin validation |

### 2026-03-23 — Waves 1–3

**New tests (selection):**

| Package | Before | After | Source |
|---------|--------|-------|--------|
| crypto | 38 | 144 | +Hmac specs, PBKDF2/HKDF tests |
| os | — | 240 | Extensive reference tests ported |
| util | 52 | 110 | format edge cases (%%, -0, BigInt, Symbol) |
| events | 60 | 119 | Extended EventEmitter tests |
| buffer | 52 | 123 | Encoding, alloc, compare, slice |
| url | — | 82 | URL/URLSearchParams compatibility tests |
| stream | 49 | 66 | Async scheduling, backpressure |
| console | — | 57 | Console.log/warn/error, formatting |
| readline | 15 | 50 | Line endings, Interface events |
| child_process | 4 | 26 | cwd, env, encoding, spawnSync |
| diagnostics_channel | 8 | 26 | Channel, TracingChannel |
| module | 6 | 14 | builtinModules, isBuiltin |

**Implementation fixes:**

- **crypto:** Replaced GLib.Hmac with pure-JS HMAC (RFC 2104) due to segfault. PBKDF2 + HKDF use the new Hmac implementation. 144 tests green on both platforms.
- **child_process:** `cwd` and `env` options via `Gio.SubprocessLauncher`; `spawnSync` with encoding support.
- **readline:** `\r` recognized as standalone line ending.
- **util.format:** `%%` escape, `-0`, BigInt, Symbol, `%i` with Infinity→NaN, remaining args without quotes.
- **os.cpus:** Real `times` from `/proc/stat` (jiffies → ms) instead of zeros.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
├─────────────────────────────────────────────────────────────────┤
│  import 'fs'  │  import 'http'  │  import 'stream'  │  fetch() │
├───────────────┴─────────────────┴────────────────────┴──────────┤
│              esbuild + @gjsify/esbuild-plugin-gjsify            │
│         (aliased: fs → @gjsify/fs, http → @gjsify/http)        │
├─────────────────────────────────────────────────────────────────┤
│                     @gjsify/* Implementations                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/fetch │  │
│  │ fs       │  │ http     │  │ stream   │  │               │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │              │                              │           │
├───────┴──────────────┴──────────────────────────────┴───────────┤
│                     GNOME Libraries (GIR)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Gio 2.0  │  │ Soup 3.0 │  │ GLib 2.0 │  │ Gtk 4.0  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│              GJS (SpiderMonkey 128 / ES2024)                    │
└─────────────────────────────────────────────────────────────────┘
```
