import type { HistoryDayCard as HistoryDayCardData } from "../../types/app";

export function HistoryDayCard({ card }: { card: HistoryDayCardData }) {
  return (
    <section className="record-card">
      <h2>
        {card.recordedOn} ({card.weekday})
      </h2>
      <ul className="record-history">
        {card.items.map((item) => (
          <li key={item.itemId}>
            <strong>{item.itemName}</strong>
            {item.lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines は毎回 buildHistoryCards で再生成される固定順の表示行
              <div key={`${item.itemId}-${index}`}>{line}</div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
