import { useState } from "react";
import { RecordItemCard } from "../features/records/RecordItemCard";
import { useTodayRecords } from "../features/records/useTodayRecords";

// タイムゾーンのずれを避けるためローカル日付から YYYY-MM-DD を組み立てる
function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function TodayPage() {
  const [recordedOn, setRecordedOn] = useState(() => toDateString(new Date()));
  const { items, records, loading, error, save } = useTodayRecords(recordedOn);

  return (
    <div className="today-page">
      <div className="date-picker">
        <label>
          記録対象日
          <input
            type="date"
            value={recordedOn}
            onChange={(e) => {
              if (e.target.value) setRecordedOn(e.target.value);
            }}
          />
        </label>
      </div>

      {loading && <p>読み込み中…</p>}
      {error && <p className="error">{error}</p>}

      {!loading &&
        items.map((item) => (
          <RecordItemCard
            key={item.id}
            item={item}
            records={records.filter((record) => record.item_id === item.id)}
            onSave={save}
          />
        ))}

      {!loading && items.length === 0 && (
        <p>有効な記録項目がありません。項目管理から追加してください。</p>
      )}
    </div>
  );
}
