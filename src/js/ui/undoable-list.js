import { showUndoToast } from "./toast.js";
import { snapshot } from "../utils.js";

/**
 * One history list's shared hygiene: rows rendered from `renderRow`, delete
 * and clear with a single undo toast, index-clamped restore and persistence
 * through `persist`. `container` may be an element or a getter, because DOM
 * refs are populated after these modules are imported. `onRender` runs after
 * each paint (button state), and `clear()` returns whether it removed anything
 * so callers can attach list-specific side effects.
 */
export function createUndoableList({
  container,
  getItems,
  setItems,
  renderRow,
  emptyMarkup,
  undoLabels,
  persist,
  onRender,
}) {
  const resolveContainer = () => (typeof container === "function" ? container() : container);

  function render() {
    const el = resolveContainer();
    if (!el) return;
    const items = getItems() || [];
    el.innerHTML = items.length === 0 ? emptyMarkup : items.map((item, idx) => renderRow(item, idx)).join("");
    if (onRender) onRender(items);
  }

  function replaceAll(items) {
    setItems(items);
    persist();
    render();
  }

  function removeAt(idx) {
    const live = getItems();
    if (!Array.isArray(live)) return;
    // Copy-on-write: never splice the live array in place — callers hold that
    // reference (state lists do), so an in-place splice mutates shared state
    // even when persist()/render throws midway.
    const at = Number(idx);
    if (!Number.isInteger(at) || at < 0 || at >= live.length) return;
    const removed = live[at];
    const removedSnapshot = snapshot(removed);
    const removedId = removed && typeof removed === "object" ? removed.id : removed;
    setItems(live.slice(0, at).concat(live.slice(at + 1)));
    persist();
    render();
    showUndoToast(undoLabels.remove, () => {
      // Merge by stable id: if the removed id is already back (re-added while
      // the toast was visible), don't duplicate it; else clamp-insert.
      const current = getItems();
      if (!Array.isArray(current)) return;
      if (
        removedId !== undefined &&
        current.some((it) => (it && typeof it === "object" ? it.id : it) === removedId)
      ) {
        persist();
        render();
        return;
      }
      const insertAt = Math.min(Math.max(0, at), current.length);
      setItems(current.slice(0, insertAt).concat([removedSnapshot], current.slice(insertAt)));
      persist();
      render();
    });
  }

  function clear() {
    const items = getItems();
    if (!items || items.length === 0) return false;
    const clearedSnapshot = snapshot(items);
    replaceAll([]);
    showUndoToast(undoLabels.clear, () => {
      // Merge, don't overwrite: items added after Clear (Clear+add+Undo) must
      // survive — restore only cleared ids that are still missing, keeping
      // current (newer) items first.
      const current = getItems() || [];
      const currentIds = new Set(
        current.map((it) => (it && typeof it === "object" ? it.id : it))
      );
      const missing = clearedSnapshot.filter((it) => {
        const id = it && typeof it === "object" ? it.id : it;
        return !currentIds.has(id);
      });
      replaceAll(current.concat(missing));
    });
    return true;
  }

  return { render, removeAt, clear, replaceAll };
}
