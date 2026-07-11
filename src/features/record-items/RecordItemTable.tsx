import type { RecordItemWithFields } from "../../types/app";

type Props = {
  items: RecordItemWithFields[];
  onToggleActive: (itemId: string) => void;
  onMove: (itemId: string, direction: "up" | "down") => void;
};

export function RecordItemTable({ items, onToggleActive, onMove }: Props) {
  if (items.length === 0) {
    return <p>記録項目がありません。</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="item-table">
        <thead>
          <tr>
            <th>項目名</th>
            <th>キー</th>
            <th>頻度</th>
            <th>フィールド</th>
            <th>状態</th>
            <th>並び順</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className={item.is_active ? "" : "inactive"}>
              <td>{item.name}</td>
              <td>{item.item_key}</td>
              <td>{item.frequency === "daily" ? "1日1回" : "複数回"}</td>
              <td>
                {item.record_fields
                  .map((field) => `${field.label} (${field.value_type})`)
                  .join(", ")}
              </td>
              <td>
                <button type="button" onClick={() => onToggleActive(item.id)}>
                  {item.is_active ? "有効" : "無効"}
                </button>
              </td>
              <td>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMove(item.id, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.id, "down")}
                >
                  ↓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
