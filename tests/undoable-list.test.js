import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function freshFactory() {
  vi.resetModules();
  return import("../src/js/ui/undoable-list.js");
}

function makeList(createUndoableList, initial = [], labels) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let items = initial.slice();
  const persist = vi.fn();
  const list = createUndoableList({
    container,
    getItems: () => items,
    setItems: (next) => {
      items = next;
    },
    renderRow: (item, idx) => `<div class="row" data-idx="${idx}">${item}</div>`,
    emptyMarkup: '<p class="empty">none</p>',
    undoLabels: labels || { remove: "ITEM DELETED", clear: "CLEARED" },
    persist,
  });
  return { container, list, persist, items: () => items };
}

describe("createUndoableList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the caller's empty state for an empty list", async () => {
    const { createUndoableList } = await freshFactory();
    const { container, list } = makeList(createUndoableList);

    list.render();

    expect(container.innerHTML).toBe('<p class="empty">none</p>');
    expect(container.querySelectorAll(".row")).toHaveLength(0);
  });

  it("renders one caller-built row per item with its index", async () => {
    const { createUndoableList } = await freshFactory();
    const { container, list } = makeList(createUndoableList, ["a", "b"]);

    list.render();

    const rows = container.querySelectorAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-idx")).toBe("0");
    expect(rows[1].getAttribute("data-idx")).toBe("1");
    expect(rows[1].textContent).toBe("b");
  });

  it("removes at an index and restores it there on undo", async () => {
    const { createUndoableList } = await freshFactory();
    const { container, list, persist, items } = makeList(createUndoableList, ["a", "b", "c"]);
    list.render();

    list.removeAt(1);

    expect(items()).toEqual(["a", "c"]);
    expect(container.querySelectorAll(".row")).toHaveLength(2);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(document.getElementById("undo-toast").textContent).toContain("ITEM DELETED");

    document.getElementById("undo-toast-btn").click();

    expect(items()).toEqual(["a", "b", "c"]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("clamps the undo insert position when the list shrank meanwhile", async () => {
    const { createUndoableList } = await freshFactory();
    const { list, items } = makeList(createUndoableList, ["a", "b", "c"]);

    list.removeAt(2);
    items().length = 0;
    document.getElementById("undo-toast-btn").click();

    expect(items()).toEqual(["c"]);
  });

  it("clears the list and restores the full snapshot on undo", async () => {
    const { createUndoableList } = await freshFactory();
    const { container, list, persist, items } = makeList(createUndoableList, ["a", "b", "c"]);

    expect(list.clear()).toBe(true);
    expect(items()).toEqual([]);
    expect(container.innerHTML).toBe('<p class="empty">none</p>');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(document.getElementById("undo-toast").textContent).toContain("CLEARED");

    document.getElementById("undo-toast-btn").click();

    expect(items()).toEqual(["a", "b", "c"]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when the list is already empty", async () => {
    const { createUndoableList } = await freshFactory();
    const { list, persist } = makeList(createUndoableList);

    expect(list.clear()).toBe(false);

    expect(persist).not.toHaveBeenCalled();
    expect(document.getElementById("undo-toast")).toBeNull();
  });

  it("gives both lists one shared toast slot: the latest action owns undo", async () => {
    const { createUndoableList } = await freshFactory();
    const listA = makeList(createUndoableList, ["a"], { remove: "A DELETED", clear: "A CLEARED" });
    const listB = makeList(createUndoableList, ["b"], { remove: "B DELETED", clear: "B CLEARED" });
    listA.list.render();
    listB.list.render();

    listA.list.removeAt(0);
    listB.list.removeAt(0);
    expect(document.getElementById("undo-toast").textContent).toContain("B DELETED");

    document.getElementById("undo-toast-btn").click();

    // showUndoToast keeps a single slot, so A's superseded callback is dropped.
    expect(listB.items()).toEqual(["b"]);
    expect(listA.items()).toEqual([]);
  });

  it("dismisses the undo toast on its own after the timeout", async () => {
    const { createUndoableList } = await freshFactory();
    const { list, items } = makeList(createUndoableList, ["a", "b"]);

    list.removeAt(0);
    const toast = document.getElementById("undo-toast");
    expect(toast.classList.contains("hidden")).toBe(false);

    // The fake timers in this suite were never advanced, so the 5s auto-dismiss
    // (and the "undo after expiry is a no-op" behaviour) went untested.
    await vi.advanceTimersByTimeAsync(5000);

    expect(toast.classList.contains("hidden")).toBe(true);
    // The slot is released, so the still-present button can no longer undo.
    document.getElementById("undo-toast-btn").click();
    expect(items()).toEqual(["b"]);
  });
});
