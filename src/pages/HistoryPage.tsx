import { HistoryDayCard } from "../features/records/HistoryDayCard";
import { useRecordHistory } from "../features/records/useRecordHistory";

export function HistoryPage() {
  const { cards, hasMore, loading, loadingMore, error, loadMore } =
    useRecordHistory();

  return (
    <div className="history-page">
      {loading && <p>読み込み中…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && cards.length === 0 && <p>まだ記録がありません。</p>}

      {cards.map((card) => (
        <HistoryDayCard key={card.recordedOn} card={card} />
      ))}

      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "読み込み中…" : "もっと見る"}
        </button>
      )}
    </div>
  );
}
