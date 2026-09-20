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
    el.innerHTML =
      items.length === 0 ? emptyMarkup : items.map((item, idx) => renderRow(item, idx)).join("");
    if (onRender) onRender(items);
  }

  function replaceAll(items) {
    setItems(items);
    persist();
    render();
  }

  function removeAt(idx) {
    const removed = getItems().splice(idx, 1)[0];
    if (removed === undefined) return;
    const removedSnapshot = snapshot(removed);
    persist();
    render();
    showUndoToast(undoLabels.remove, () => {
      // The list may have changed while the toast was visible: clamp the old
      // index so undoing a delete can never corrupt the array shape.
      const live = getItems();
      const insertAt = Math.min(Math.max(0, idx), live.length);
      live.splice(insertAt, 0, removedSnapshot);
      persist();
      render();
    });
  }

  function clear() {
    const items = getItems();
    if (!items || items.length === 0) return false;
    const clearedSnapshot = snapshot(items);
    replaceAll([]);
    showUndoToast(undoLabels.clear, () => replaceAll(clearedSnapshot));
    return true;
  }

  return { render, removeAt, clear, replaceAll };
}
