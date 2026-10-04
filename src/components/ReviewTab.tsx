import { useMemo, useState } from "react";
import { useStore } from "../domain/store";

export function ReviewTab() {
  const { state, addPlan, updatePlan } = useStore();
  const [horseId, setHorseId] = useState<string>(Object.values(state.horses)[0]?.id ?? "");
  const [recordNo, setRecordNo] = useState<string>("");
  const [reviewDate, setReviewDate] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [msg, setMsg] = useState<string>("");

  const horseRecords = useMemo(
    () => Object.values(state.records).filter((r) => r.horseId === horseId),
    [state.records, horseId]
  );

  const plans = Object.values(state.plans).sort((a, b) => b.updatedAt - a.updatedAt);
  const notifications = Object.values(state.notifications).sort((a, b) => b.createdAt - a.createdAt);

  const submit = () => {
    if (!horseId || !reviewDate) return;
    addPlan(horseId, recordNo || horseRecords[0]?.recordNo || "", reviewDate, reason);
    setMsg("复查计划已建立");
    setReviewDate("");
    setReason("");
  };

  const changeDate = (id: string, newDate: string) => {
    updatePlan(id, { reviewDate: newDate });
    setMsg("复查日期已变化，已签意见和通知立即失效重算");
  };

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>复查计划</p>
          <h2>下次复查日期与通知</h2>
        </div>
      </div>

      <div className="review-layout">
        <section className="panel">
          <div className="heading">
            <div>
              <p>新建计划</p>
              <h3>安排复查</h3>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>马匹</span>
              <select value={horseId} onChange={(e) => { setHorseId(e.target.value); setRecordNo(""); }}>
                {Object.values(state.horses).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>关联记录号</span>
              <select value={recordNo} onChange={(e) => setRecordNo(e.target.value)}>
                <option value="">不关联</option>
                {horseRecords.map((r) => (
                  <option key={r.id} value={r.recordNo}>
                    {r.recordNo}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>下次复查日期</span>
              <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </label>
            <label>
              <span>复查原因</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 右前蹄外侧磨耗复查" />
            </label>
          </div>
          {msg && <div className="notice success">✓ {msg}</div>}
          <div className="btn-row">
            <button className="primary" onClick={submit}>
              建立复查计划
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="heading">
            <div>
              <p>复查通知</p>
              <h3>仅处置后生成</h3>
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="muted">暂无复查通知。蹄位经兽医签字锁定（处置）后才生成通知。</p>
          ) : (
            <div className="notification-list">
              {notifications.map((n) => (
                <div key={n.id} className={"notification-item " + (n.invalid ? "invalid" : "")}>
                  <div>
                    <code>{n.recordNo}</code>
                    <div className="muted">
                      {state.horses[n.horseId]?.name} · 复查 {n.reviewDate}
                    </div>
                    <div className="muted">{n.reason}</div>
                  </div>
                  {n.invalid ? (
                    <span className="badge invalid">已失效 · 待重算</span>
                  ) : (
                    <span className="badge lock">已通知</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="heading">
          <div>
            <p>复查计划列表</p>
            <h3>日期变化 → 意见与通知失效重算</h3>
          </div>
        </div>
        {plans.length === 0 ? (
          <p className="muted">暂无复查计划。</p>
        ) : (
          <div className="plan-list">
            {plans.map((p) => (
              <div key={p.id} className="plan-item">
                <div>
                  <code>{p.recordNo || "未关联"}</code>
                  <div className="muted">{state.horses[p.horseId]?.name}</div>
                  <div className="muted">{p.reason}</div>
                </div>
                <div className="plan-date">
                  <span className="muted">下次复查</span>
                  <input
                    type="date"
                    value={p.reviewDate}
                    onChange={(e) => changeDate(p.id, e.target.value)}
                  />
                  {p.invalid && <span className="badge invalid">已失效</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
