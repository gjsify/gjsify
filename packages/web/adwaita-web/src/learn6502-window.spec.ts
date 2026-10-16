// Learn6502's `main.window.blp`, reduced to the shapes that rendered short through
// `buildWithSiblings`: header-bar buttons after a single `[start]` (GtkBuilder packs an untyped
// child at start too), and `Overlay { child: Adw.ToastOverlay { Stack } }`. Every
// widget the file authors has to be in the document once the built window is attached — the
// failure was widgets that were built and then silently dropped on the way.
import { describe, expect, it } from '@gjsify/unit';
import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';

import { buildWithSiblings } from './shared-tree-builder.js';

const BLUEPRINT = `using Gtk 4.0;
using Adw 1;

Adw.ApplicationWindow mainWindow {
  content: Adw.ToolbarView toolbarView {
    [top]
    Adw.HeaderBar headerBar {
      title-widget: Label titleLabel {
        label: "Learn 6502";
      };

      [start]
      ToggleButton sidebarToggleButton {
        icon-name: "sidebar-show-symbolic";
      }

      Button learnBackButton {
        icon-name: "go-previous-symbolic";
      }

      Button unsavedChangesIndicator {
        icon-name: "dot-symbolic";
      }

      [end]
      MenuButton menuButton {
        icon-name: "open-menu-symbolic";
      }
    }

    content: Overlay mainOverlay {
      child: Adw.ToastOverlay toastOverlay {
        Stack layoutHost {
          StackPage singlePage {
            name: "single";
            child: Adw.Bin singleContainer {
              child: Label singleLabel {
                label: "single";
              };
            };
          }

          StackPage threePage {
            name: "three";
            child: Adw.Bin threeColumnContainer {
              child: Box threeColumns {
                Label threeLabel {
                  label: "three";
                }
              };
            };
          }
        }
      };
    };
  };
}
`;

const AUTHORED = [
    'toolbarView',
    'headerBar',
    'titleLabel',
    'sidebarToggleButton',
    'learnBackButton',
    'unsavedChangesIndicator',
    'menuButton',
    'mainOverlay',
    'toastOverlay',
    'layoutHost',
    'singleContainer',
    'singleLabel',
    'threeColumnContainer',
    'threeColumns',
    'threeLabel',
];

export const AdwLearn6502WindowTest = async () => {
    await describe("Learn6502's main window through buildWithSiblings", async () => {
        const { node, lost } = projectToSharedNode(parseBlueprint(BLUEPRINT, 'main.window.blp'));

        await it('projects without losing anything', () => {
            expect(lost.map((loss) => `${loss.kind}@${loss.line}`).join()).toBe('');
        });

        await it('puts every authored widget in the document, the start buttons at start', () => {
            const { root } = buildWithSiblings(node);
            document.body.append(root);
            const missing = AUTHORED.filter((id) => !root.querySelector(`#${id}`)?.isConnected);
            const start = ['sidebarToggleButton', 'learnBackButton', 'unsavedChangesIndicator'].filter(
                (id) => root.querySelector(`#${id}`)?.parentElement?.className !== 'adw-header-bar-start',
            );
            const toast = root.querySelector('#toastOverlay');
            const overlaid =
                toast?.closest('.adw-overlay-child') === root.querySelector('#mainOverlay > .adw-overlay-child');
            root.remove();

            expect(missing.join()).toBe('');
            expect(start.join()).toBe('');
            expect(overlaid).toBe(true);
        });
    });
};
