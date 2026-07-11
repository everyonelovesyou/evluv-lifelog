import { NewRecordItemForm } from "../features/record-items/NewRecordItemForm";
import { RecordItemTable } from "../features/record-items/RecordItemTable";
import { useRecordItems } from "../features/record-items/useRecordItems";

export function RecordItemsPage() {
  const { items, loading, error, addItem, toggleActive, moveItem } =
    useRecordItems();

  return (
    <div className="items-page">
      <h1>記録項目管理</h1>
      {loading && <p>読み込み中…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && (
        <RecordItemTable
          items={items}
          onToggleActive={(id) => void toggleActive(id)}
          onMove={(id, direction) => void moveItem(id, direction)}
        />
      )}
      <NewRecordItemForm onSubmit={addItem} />
    </div>
  );
}
