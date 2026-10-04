import { useMemo, useState } from "react";
import { useStore } from "../domain/store";
import { HoofPosition, HoofRecord, HOOF_LABELS, HOOF_POSITIONS } from "../domain/types";
import { HoofDiagram } from "./HoofDiagram";
import { handledCount, isHandled } from "../domain/engine";

export function VetTab() {
  const { state, vetSign } = useStore();
  const [recordNo, setRecordNo] = useState<string>("");
  const [pos, setPos] = useState<HoofPosition>("LF");
  const [pain, setPain] = useState<number>(0);
  const [msg, setMsg] = useState<string>("");

  // 兽医审核门诊正式库；离线草稿需先合并
  const records = useMemo(
    () => Object.values(state.records).sort((a, b) => b.createdAt - a.createdAt),
    [state.records]
  );
  const pendingMergeCount = Object.keys(state.localRecords).length;

  const active = useMemo(
    () => records.find((r) => r.recordNo === recordNo) ?? records[0],
    [records, recordNo]
  );

  const pickPos = (p: HoofPosition) => {
    setPos(p);
    setMsg("");
    if (active) setPain(active.hooves[p].painScore ?? 0);
  };

  const sign = () => {
    if (!active) return;
    vetSign(active.recordNo, pos, pain);
    setMsg(`${HOOF_LABELS[pos]} 疼痛评分 ${pain} 已签字确认，蹄位方案锁定`);
  };

  if (!active) {
    return (
      <div className="tab-panel">
        <div className="heading">
          <div>
            <p>兽医 · 门诊审核</p>
            <h2>蹄病审核与疼痛评分</h2>
          </div>
        </div>
        {pendingMergeCount > 0 && (
          <div className="notice warn">
            有 {pendingMergeCount} 份蹄铁师离线草稿尚未合并，请先到「合并中心」回网合并后再审核。
          </div>
        )}
        <div className="panel empty">
          <p>暂无门诊记录。蹄铁师离线登记并回网合并后，在此签字确认。</p>
        </div>
      </div>
    );
  }

  const h = active.hooves[pos];
  const horse = state.horses[active.horseId];
  const pendingCount = HOOF_POSITIONS.filter((p) => !isHandled(active.hooves[p])).length;

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>兽医 · 门诊审核</p>
          <h2>蹄病审核与疼痛评分</h2>
        </div>
        <div className="btn-row">
          {pendingMergeCount > 0 && (
            <span className="badge pend">{pendingMergeCount} 份草稿待合并</span>
          )}
          <span className="muted">待处置蹄位 {pendingCount}/4</span>
        </div>
      </div>

      {pendingMergeCount > 0 && (
        <div className="notice warn">
          有 {pendingMergeCount} 份蹄铁师离线草稿尚未合并，合并后在此审核签字。
        </div>
      )}

      <div className="record-layout">
        <aside className="record-list">
          <label>
            <span>选择记录</span>
            <select value={active.recordNo} onChange={(e) => { setRecordNo(e.target.value); setMsg(""); }}>
              {records.map((r) => {
                const hr = state.horses[r.horseId];
                return (
                  <option key={r.id} value={r.recordNo}>
                    {hr?.name} · {r.recordNo}（处置 {handledCount(r)}/4）
                  </option>
                );
              })}
            </select>
          </label>
          <div className="record-items">
            {records.map((r) => (
              <button
                key={r.id}
                className={"record-item " + (active.id === r.id ? "active" : "")}
                onClick={() => { setRecordNo(r.recordNo); setMsg(""); }}
              >
                <div className="record-item-head">
                  <code>{r.recordNo}</code>
                  <SyncBadge status={r.syncStatus} />
                </div>
                <div className="muted">{state.horses[r.horseId]?.name} · {r.date}</div>
                <div className="muted">已处置 {handledCount(r)}/4</div>
              </button>
            ))}
          </div>
        </aside>

        <div className="record-editor">
          <HoofDiagram record={active} selected={pos} onSelect={pickPos} />

          <div className="panel hoof-form">
            <div className="hoof-form-head">
              <h3>{HOOF_LABELS[pos]}</h3>
              <span className="muted">{horse?.name} · {active.recordNo}</span>
            </div>

            <div className="hoof-detail">
              <div className="detail-row">
                <span>蹄形</span>
                <strong>{h.shape || "—"}</strong>
              </div>
              <div className="detail-row">
                <span>蹄铁类型</span>
                <strong>{h.ironType || "—"}</strong>
              </div>
              <div className="detail-row">
                <span>钉位</span>
                <strong>{h.nailPositions || "—"}</strong>
              </div>
              <div className="detail-row">
                <span>当前疼痛评分</span>
                <strong>{h.painScore ?? "未评分"}</strong>
              </div>
              <div className="detail-row">
                <span>状态</span>
                <strong>
                  {h.locked ? (
                    <span className="badge lock">已锁定</span>
                  ) : h.opinionInvalid ? (
                    <span className="badge invalid">意见失效待重算</span>
                  ) : (
                    <span className="badge pend">待签字</span>
                  )}
                </strong>
              </div>
            </div>

            {h.pending && (
              <div className="notice warn">
                该蹄位有另一版待处理：蹄铁师改动（蹄形 {h.pendingShape || "—"} / 蹄铁 {h.pendingIronType || "—"} / 钉位 {h.pendingNailPositions || "—"}）。已保留兽医安全值，待兽医复核。
              </div>
            )}

            <div className="field-grid">
              <label>
                <span>疼痛评分（0-10，兽医安全值）</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={pain}
                  onChange={(e) => setPain(Number(e.target.value))}
                />
              </label>
            </div>
            {msg && <div className="notice success">✓ {msg}</div>}
            <div className="btn-row">
              <button className="primary" onClick={sign}>
                签字确认并锁定蹄位
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SyncBadge({ status }: { status: HoofRecord["syncStatus"] }) {
  const map: Record<HoofRecord["syncStatus"], { text: string; cls: string }> = {
    local: { text: "离线草稿", cls: "local" },
    synced: { text: "已同步", cls: "synced" },
    pending: { text: "待处理", cls: "pending" },
    conflict: { text: "冲突", cls: "conflict" },
    failed: { text: "合并失败", cls: "failed" },
  };
  const m = map[status];
  return <span className={"sync-badge " + m.cls}>{m.text}</span>;
}
