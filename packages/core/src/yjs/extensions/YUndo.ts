import { Plugin } from "prosemirror-state";
import {
  defaultDeleteFilter,
  defaultProtectedNodes,
  getRelativeSelection,
  redoCommand,
  undoCommand,
  ySyncPluginKey,
  yUndoPluginKey,
} from "y-prosemirror";
import { UndoManager } from "yjs";
import {
  createExtension,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";

/**
 * State held by the {@link createRemountSafeYUndoPlugin} ProseMirror plugin.
 * Mirrors y-prosemirror's internal `UndoPluginState`.
 */
type YUndoPluginState = {
  undoManager: UndoManager;
  prevSel: ReturnType<typeof getRelativeSelection> | null;
  hasUndoOps: boolean;
  hasRedoOps: boolean;
};

/**
 * Remount-safe re-implementation of y-prosemirror's `yUndoPlugin`.
 *
 * Upstream `yUndoPlugin` ties the Yjs `UndoManager` lifetime to the ProseMirror
 * **view**: its `view().destroy()` calls `undoManager.destroy()`, unregistering
 * the manager's observers from the shared Y type. That assumption — "view
 * destroyed == editor gone" — is wrong for tiptap 3, which DESTROYS AND
 * RECREATES the EditorView on remount while **preserving** `editor.editorState`
 * (see `Editor.unmount()` / `Editor.createView()` — the new view is built from
 * the retained state and `EditorState.reconfigure` keeps existing plugin state).
 *
 * The view is remounted not only by React StrictMode's double-mount but on every
 * `isEditable` toggle: BlockNoteView's `mount` callback lists `editable` in its
 * deps and re-runs `editor.unmount()` + `editor.mount()` to restore the tabIndex
 * attribute. In a collaborative app `editable` flips on every connection blip, so
 * a transient disconnect would silently kill undo.
 *
 * Concretely, with upstream's plugin: first view teardown -> `undoManager.destroy()`
 * -> the now-dead manager stays in the preserved plugin state -> the remounted
 * view re-binds to it -> it no longer tracks local edits -> Ctrl+Z no-ops
 * (`undoStack.length` stuck at 0). A full editor recreate (fast refresh) hides it
 * by building a fresh live manager.
 *
 * This variant keeps the manager alive across view remounts: `view().destroy()`
 * detaches only the per-view selection-tracking listeners it added. The manager
 * lives in plugin state alongside `editor.editorState` and is garbage-collected
 * with the editor and its Y.Doc. Behaviour is otherwise identical to upstream.
 */
const createRemountSafeYUndoPlugin = ({
  protectedNodes = defaultProtectedNodes,
  trackedOrigins = [],
  undoManager = null,
}: {
  protectedNodes?: Set<string>;
  trackedOrigins?: any[];
  undoManager?: UndoManager | null;
} = {}) =>
  new Plugin<YUndoPluginState>({
    key: yUndoPluginKey,
    state: {
      init: (_initargs, state) => {
        const ystate = ySyncPluginKey.getState(state);
        const _undoManager =
          undoManager ||
          new UndoManager(ystate.type, {
            trackedOrigins: new Set([ySyncPluginKey, ...trackedOrigins]),
            deleteFilter: (item) => defaultDeleteFilter(item, protectedNodes),
            captureTransaction: (tr) => tr.meta.get("addToHistory") !== false,
          });
        return {
          undoManager: _undoManager,
          prevSel: null,
          hasUndoOps: _undoManager.undoStack.length > 0,
          hasRedoOps: _undoManager.redoStack.length > 0,
        };
      },
      apply: (_tr, val, oldState, state) => {
        const binding = ySyncPluginKey.getState(state).binding;
        const undoManager = val.undoManager;
        const hasUndoOps = undoManager.undoStack.length > 0;
        const hasRedoOps = undoManager.redoStack.length > 0;
        if (binding) {
          return {
            undoManager,
            prevSel: getRelativeSelection(binding, oldState),
            hasUndoOps,
            hasRedoOps,
          };
        } else if (
          hasUndoOps !== val.hasUndoOps ||
          hasRedoOps !== val.hasRedoOps
        ) {
          return Object.assign({}, val, { hasUndoOps, hasRedoOps });
        } else {
          // nothing changed
          return val;
        }
      },
    },
    view: (view) => {
      const ystate = ySyncPluginKey.getState(view.state);
      const undoManager = yUndoPluginKey.getState(view.state)!.undoManager;
      const onStackItemAdded = ({ stackItem }: { stackItem: any }) => {
        const binding = ystate.binding;
        if (binding) {
          stackItem.meta.set(
            binding,
            yUndoPluginKey.getState(view.state)!.prevSel,
          );
        }
      };
      const onStackItemPopped = ({ stackItem }: { stackItem: any }) => {
        const binding = ystate.binding;
        if (binding) {
          binding.beforeTransactionSelection =
            stackItem.meta.get(binding) || binding.beforeTransactionSelection;
        }
      };
      undoManager.on("stack-item-added", onStackItemAdded);
      undoManager.on("stack-item-popped", onStackItemPopped);
      return {
        destroy: () => {
          // Detach only the per-view listeners. Deliberately NOT
          // `undoManager.destroy()`: tiptap recreates the view on remount while
          // preserving the plugin state that holds this manager, so destroying it
          // would leave a dead manager bound to the remounted view (the broken
          // collaborative-undo bug). The manager is GC'd with the editor/Y.Doc.
          undoManager.off("stack-item-added", onStackItemAdded);
          undoManager.off("stack-item-popped", onStackItemPopped);
        },
      };
    },
  });

export const YUndoExtension = createExtension(({ editor }: ExtensionOptions) => {
  // The UndoManager now outlives the ProseMirror *view* (so undo survives view
  // remounts — see createRemountSafeYUndoPlugin), which means it is no longer
  // torn down on view destroy. It must instead be destroyed when the *editor* is
  // destroyed, otherwise its Yjs observers linger on the Y.Doc. `mount()` runs on
  // every (re)mount, so bind the editor's one-time "destroy" event once. tiptap
  // emits "destroy" before tearing the view down, so the manager is still
  // reachable via the captured reference when it fires.
  let editorDestroyBound = false;
  return {
    key: "yUndo",
    prosemirrorPlugins: [createRemountSafeYUndoPlugin()],
    dependsOn: ["yCursor", "ySync"],
    undoCommand: undoCommand,
    redoCommand: redoCommand,
    mount() {
      if (!editorDestroyBound) {
        editorDestroyBound = true;
        const undoManager =
          yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager ?? null;
        editor._tiptapEditor.on("destroy", () => undoManager?.destroy());
      }
      return undefined;
    },
  } as const;
});
