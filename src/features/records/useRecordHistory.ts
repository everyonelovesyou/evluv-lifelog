import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryDayCard, HistoryRecordRow } from "../../types/app";
import { fetchRecordHistory } from "./api";
import { buildHistoryCards } from "./buildHistoryCards";

const PAGE_SIZE = 30;

type HistoryState = {
  cards: HistoryDayCard[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
};

export function useRecordHistory(): HistoryState {
  const [rows, setRows] = useState<HistoryRecordRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchRecordHistory(null, PAGE_SIZE);
      setRows(next);
      setHasMore(next.length > 0 ? next[0].has_more : false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    // 二重発火・初回ロード中・これ以上ない場合は何もしない
    if (loadingMore || loading || !hasMore) return;
    // RPC は recorded_on 降順なので末尾が最古。それをカーソルにする
    const oldest = rows.length > 0 ? rows[rows.length - 1].recorded_on : null;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const next = await fetchRecordHistory(oldest, PAGE_SIZE);
      setRows((prev) => [...prev, ...next]);
      setHasMore(next.length > 0 ? next[0].has_more : false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoadingMore(false);
    }
  }, [rows, hasMore, loading, loadingMore]);

  const cards = useMemo(() => buildHistoryCards(rows), [rows]);

  return { cards, hasMore, loading, loadingMore, error, loadMore };
}
