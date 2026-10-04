import { HoofPosition, HoofRecord, HOOF_LABELS, HOOF_ORDER } from "../domain/types";
import { isHandled } from "../domain/engine";

interface HoofDiagramProps {
  record: HoofRecord;
  onSelect?: (pos: HoofPosition) => void;
  selected?: HoofPosition | null;
}

/** 四蹄俯视示意图：左前/右前在上，左后/右后在下 */
export function HoofDiagram({ record, onSelect, selected }: HoofDiagramProps) {
  const positions = Object.keys(HOOF_ORDER).sort(
    (a, b) => HOOF_ORDER[a as HoofPosition] - HOOF_ORDER[b as HoofPosition]
  ) as HoofPosition[];

  return (
    <div className="hoof-diagram">
      <div className="hoof-row">
        {positions.slice(0, 2).map((pos) => (
          <HoofCard
            key={pos}
            pos={pos}
            record={record}
            active={selected === pos}
            onClick={() => onSelect?.(pos)}
          />
        ))}
      </div>
      <div className="hoof-row">
        {positions.slice(2, 4).map((pos) => (
          <HoofCard
            key={pos}
            pos={pos}
            record={record}
            active={selected === pos}
            onClick={() => onSelect?.(pos)}
          />
        ))}
      </div>
    </div>
  );
}

function HoofCard({
  pos,
  record,
  active,
  onClick,
}: {
  pos: HoofPosition;
  record: HoofRecord;
  active: boolean;
  onClick: () => void;
}) {
  const h = record.hooves[pos];
  const handled = isHandled(h);
  const cls = ["hoof-card", active ? "active" : "", handled ? "locked" : "", h.pending ? "pending" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} onClick={onClick}>
      <div className="hoof-pos">{pos}</div>
      <div className="hoof-label">{HOOF_LABELS[pos]}</div>
      <div className="hoof-shape">{h.shape || "未登记"}</div>
      <div className="hoof-iron">{h.ironType || "—"}</div>
      {h.painScore !== null && <div className="hoof-pain">疼痛 {h.painScore}</div>}
      <div className="hoof-badges">
        {h.locked && <span className="badge lock">已锁定</span>}
        {h.pending && <span className="badge pend">待处理</span>}
        {h.opinionInvalid && <span className="badge invalid">意见失效</span>}
      </div>
    </button>
  );
}
