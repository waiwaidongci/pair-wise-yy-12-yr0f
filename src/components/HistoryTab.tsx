import { useMemo, useState } from "react";
import { useStore } from "../domain/store";
import { hoofChangeCount } from "../domain/engine";
import { HOOF_LABELS, HOOF_POSITIONS } from "../domain/types";

export function HistoryTab() {
  const { state } = useStore();
  const [horseId, setHorseId] = useState<string>(Object.values(state.horses)[0]?.id ?? "");

  const horse = state.horses[horseId];
  const records = useMemo(
    () =>
      Object.values(state.records)
        .filter((r) => r.horseId === horseId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.records, horseId]
  );

  const changeCount = hoofChangeCount(state, horseId);

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>蹄铁更换历史</p>
          <h2>历史修蹄记录可查</h2>
        </div>
        <label className="inline-label">
          <span>选择马匹</span>
          <select value={horseId} onChange={(e) => setHorseId(e.target.value)}>
            {Object.values(state.horses).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {horse && (
        <>
          <div className="history-summary">
            <div className="summary-card">
              <small>基准号</small>
              <strong>
                {horse.baselineMissing || !horse.baselineNo ? (
                  <span className="badge invalid">待补齐</span>
                ) : (
                  <code>{horse.baselineNo}</code>
                )}
              </strong>
            </div>
            <div className="summary-card">
              <small>累计换蹄次数</small>
              <strong>{changeCount}</strong>
              <span className="muted">仅计已确认记录，重试不重复计入</span>
            </div>
            <div className="summary-card">
              <small>历史记录数</small>
              <strong>{records.length}</strong>
              <span className="muted">含离线本地与已合并</span>
            </div>
          </div>

          <div className="timeline">
            {records.length === 0 && <p className="muted">暂无历史修蹄记录。</p>}
            {records.map((r) => (
              <div key={r.id} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-head">
                    <code>{r.recordNo}</code>
                    <span className="muted">{r.date}</span>
                    <SyncBadge status={r.syncStatus} />
                  </div>
                  <div className="timeline-hooves">
                    {HOOF_POSITIONS.map((pos) => {
                      const h = r.hooves[pos];
                      return (
                        <div key={pos} className="timeline-hoof">
                          <strong>{HOOF_LABELS[pos]}</strong>
                          <span>{h.shape || "未登记"}</span>
                          <span className="muted">{h.ironType || "—"}</span>
                          {h.painScore !== null && <span className="muted">疼痛 {h.painScore}</span>}
                          {h.locked && <span className="badge lock">锁定</span>}
                          {h.pending && <span className="badge pend">待处理</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SyncBadge({ status }: { status: import("../domain/types").HoofRecord["syncStatus"] }) {
  const map: Record<string, { text: string; cls: string }> = {
    local: { text: "离线本地", cls: "local" },
    synced: { text: "已同步", cls: "synced" },
    pending: { text: "待处理", cls: "pending" },
    conflict: { text: "冲突", cls: "conflict" },
    failed: { text: "合并失败", cls: "failed" },
  };
  const m = map[status];
  return <span className={"sync-badge " + m.cls}>{m.text}</span>;
}
