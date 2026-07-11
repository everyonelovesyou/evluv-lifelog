import { useCallback, useEffect, useState } from "react";
import type { RecordItemWithFields } from "../../types/app";
import {
  createItem,
  fetchAllItemsWithFields,
  type NewItemInput,
  setItemActive,
  swapSortOrder,
} from "./api";

type RecordItemsState = {
  items: RecordItemWithFields[];
  loading: boolean;
  error: string | null;
  addItem: (input: NewItemInput) => Promise<void>;
  toggleActive: (itemId: string) => Promise<void>;
  moveItem: (itemId: string, direction: "up" | "down") => Promise<void>;
};

export function useRecordItems(): RecordItemsState {
  const [items, setItems] = useState<RecordItemWithFields[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await fetchAllItemsWithFields());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addItem = useCallback(
    async (input: NewItemInput) => {
      await createItem(input);
      await reload();
    },
    [reload],
  );

  const toggleActive = useCallback(
    async (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      await setItemActive(itemId, !item.is_active);
      await reload();
    },
    [items, reload],
  );

  const moveItem = useCallback(
    async (itemId: string, direction: "up" | "down") => {
      const index = items.findIndex((i) => i.id === itemId);
      if (index < 0) return;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= items.length) return;
      await swapSortOrder(items[index], items[targetIndex]);
      await reload();
    },
    [items, reload],
  );

  return { items, loading, error, addItem, toggleActive, moveItem };
}
