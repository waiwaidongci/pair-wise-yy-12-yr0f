import { useMemo, useState } from "react";
import { useStore } from "../domain/store";
import { HoofPosition, HoofRecord, HOOF_LABELS } from "../domain/types";
import { HoofDiagram } from "./HoofDiagram";
import { handledCount } from "../domain/engine";

export function RecordsTab() {
  const { state, createLocalRecord, farrierEditHoof } = useStore();
  const [horseId, setHorseId] = useState<string>(Object.values(state.horses)[0]?.id ?? "");
  const [recordNo, setRecordNo] = useState<string>("");
  const [pos, setPos] = useState<HoofPosition>("LF");
  const [form, setForm] = useState({ shape: "", ironType: "", nailPositions: "", note: "" });
  const [err, setErr] = useState<string>("");
  const [ok, setOk] = useState<string>("");

  // 蹄铁师可见：离线草稿（localRecords）+ 门诊正式库（records，只读）
  const localList = useMemo(
    () => Object.values(state.localRecords).filter((r) => r.horseId === horseId),
    [state.localRecords, horseId]
  );
  const canonicalList = useMemo(
    () => Object.values(state.records).filter((r) => r.horseId === horseId),
    [state.records, horseId]
  );

  // 当前编辑的记录：优先离线草稿，其次门诊正式库
  const activeLocal = localList.find((r) => r.recordNo === recordNo);
  const activeCanonical = canonicalList.find((r) => r.recordNo === recordNo);
  const activeRecord = activeLocal ?? activeCanonical;
  const isDraft = Boolean(activeLocal);

  const selectRecord = (r: HoofRecord) => {
    setRecordNo(r.recordNo);
    setErr("");
    setOk("");
    const h = r.hooves[pos];
    setForm({ shape: h.shape, ironType: h.ironType, nailPositions: h.nailPositions, note: h.note });
  };

  const pickPos = (p: HoofPosition) => {
    setPos(p);
    setErr("");
    setOk("");
    if (activeRecord) {
      const h = activeRecord.hooves[p];
      setForm({ shape: h.shape, ironType: h.ironType, nailPositions: h.nailPositions, note: h.note });
    }
  };

  const createRecord = () => {
    if (!horseId) return;
    const no = createLocalRecord(horseId, new Date().toISOString().slice(0, 10));
    setRecordNo(no);
    setErr("");
    setOk("已离线保存为草稿，回网后按记录号合并");
  };

  const saveHoof = () => {
    if (!activeRecord) return;
    const res = farrierEditHoof(activeRecord.recordNo, pos, form);
    if (!res.ok) {
      setErr(res.error ?? "保存失败");
      setOk("");
    } else {
      setErr("");
      setOk(`${HOOF_LABELS[pos]} 已登记（离线草稿）`);
    }
  };

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>蹄铁师 · 离线登记</p>
          <h2>修蹄记录（四蹄蹄形 / 蹄铁 / 钉位）</h2>
        </div>
        <button className="primary" onClick={createRecord} disabled={!horseId}>
          新增修蹄记录
        </button>
      </div>

      <div className="record-layout">
        <aside className="record-list">
          <label>
            <span>选择马匹</span>
            <select value={horseId} onChange={(e) => { setHorseId(e.target.value); setRecordNo(""); }}>
              {Object.values(state.horses).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}（{h.baselineMissing || !h.baselineNo ? "基准号待补齐" : h.baselineNo}）
                </option>
              ))}
            </select>
          </label>

          {localList.length > 0 && (
            <>
              <p className="list-group-title">离线草稿（可编辑）</p>
              <div className="record-items">
                {localList.map((r) => (
                  <button
                    key={r.id}
                    className={"record-item " + (activeRecord?.id === r.id ? "active" : "")}
                    onClick={() => selectRecord(r)}
                  >
                    <div className="record-item-head">
                      <code>{r.recordNo}</code>
                      <SyncBadge status={r.syncStatus} />
                    </div>
                    <div className="muted">{r.date}</div>
                    <div className="muted">已处置 {handledCount(r)}/4</div>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="list-group-title">门诊正式库（只读）</p>
          <div className="record-items">
            {canonicalList.length === 0 && <p className="muted">暂无门诊记录</p>}
            {canonicalList.map((r) => (
              <button
                key={r.id}
                className={"record-item " + (activeRecord?.id === r.id && !isDraft ? "active" : "")}
                onClick={() => selectRecord(r)}
              >
                <div className="record-item-head">
                  <code>{r.recordNo}</code>
                  <SyncBadge status={r.syncStatus} />
                </div>
                <div className="muted">{r.date}</div>
                <div className="muted">已处置 {handledCount(r)}/4</div>
              </button>
            ))}
          </div>
        </aside>

        {activeRecord ? (
          <div className="record-editor">
            <HoofDiagram record={activeRecord} selected={pos} onSelect={pickPos} />

            <div className="panel hoof-form">
              <div className="hoof-form-head">
                <h3>{HOOF_LABELS[pos]}</h3>
                <span className="muted">
                  {activeRecord.recordNo} · {isDraft ? "离线草稿" : "门诊正式库（只读）"}
                </span>
              </div>

              {!isDraft && (
                <div className="notice warn">
                  门诊正式库只读。保存将创建离线草稿，回网后按记录号合并；若蹄位已锁定，草稿改动将在合并时与兽医安全值比对。
                </div>
              )}

              <div className="field-grid">
                <label>
                  <span>蹄形</span>
                  <input
                    value={form.shape}
                    onChange={(e) => setForm({ ...form, shape: e.target.value })}
                    placeholder="如 正常 / 外侧磨耗 / 裂纹"
                  />
                </label>
                <label>
                  <span>蹄铁类型</span>
                  <input
                    value={form.ironType}
                    onChange={(e) => setForm({ ...form, ironType: e.target.value })}
                    placeholder="如 铝蹄铁 / 加护蹄垫"
                  />
                </label>
                <label>
                  <span>钉位</span>
                  <input
                    value={form.nailPositions}
                    onChange={(e) => setForm({ ...form, nailPositions: e.target.value })}
                    placeholder="如 1,2,3"
                  />
                </label>
                <label>
                  <span>备注</span>
                  <input
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="照片/备注"
                  />
                </label>
              </div>
              {err && <div className="notice error">⛔ {err}</div>}
              {ok && <div className="notice success">✓ {ok}</div>}
              <div className="btn-row">
                <button className="primary" onClick={saveHoof}>
                  {isDraft ? "保存蹄位（离线草稿）" : "创建离线草稿并保存"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="panel empty">
            <p>选择或新增一条修蹄记录开始登记。</p>
          </div>
        )}
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
