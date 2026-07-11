import { useCallback, useEffect, useState } from "react";
import type { RecordItemWithFields, RecordWithValues } from "../../types/app";
import {
  fetchActiveItemsWithFields,
  fetchRecordsByDate,
  type SaveValueInput,
  saveRecord,
} from "./api";

type TodayRecordsState = {
  items: RecordItemWithFields[];
  records: RecordWithValues[];
  loading: boolean;
  error: string | null;
  save: (itemId: string, values: SaveValueInput[]) => Promise<void>;
  reload: () => Promise<void>;
};

export function useTodayRecords(recordedOn: string): TodayRecordsState {
  const [items, setItems] = useState<RecordItemWithFields[]>([]);
  const [records, setRecords] = useState<RecordWithValues[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextItems, nextRecords] = await Promise.all([
        fetchActiveItemsWithFields(),
        fetchRecordsByDate(recordedOn),
      ]);
      setItems(nextItems);
      setRecords(nextRecords);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [recordedOn]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const save = useCallback(
    async (itemId: string, values: SaveValueInput[]) => {
      await saveRecord(itemId, recordedOn, values);
      await reload();
    },
    [recordedOn, reload],
  );

  return { items, records, loading, error, save, reload };
}
