import { useMemo } from "react";
import { useStore } from "../domain/store";
import { HOOF_LABELS } from "../domain/types";

export function MergeTab() {
  const {
    state,
    setOnline,
    mergeLocal,
    mergeAll,
    simulateFailure,
    retryRecord,
  } = useStore();

  // 待合并：离线草稿中有未合并改动的（syncStatus === 'local'）
  const localRecords = useMemo(
    () => Object.values(state.localRecords).filter((r) => r.syncStatus === "local"),
    [state.localRecords]
  );
  // 失败/冲突：门诊正式库中的记录
  const failedRecords = useMemo(
    () => Object.values(state.records).filter((r) => r.syncStatus === "failed"),
    [state.records]
  );
  const conflictRecords = useMemo(
    () => Object.values(state.records).filter((r) => r.syncStatus === "conflict"),
    [state.records]
  );

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>离线协作</p>
          <h2>合并中心</h2>
        </div>
        <div className="btn-row">
          <span className={"online-pill " + (state.online ? "on" : "off")}>
            {state.online ? "● 回网在线" : "○ 断网离线"}
          </span>
          <button onClick={() => setOnline(!state.online)}>
            {state.online ? "切换为断网" : "切换为回网"}
          </button>
          <button className="primary" onClick={mergeAll} disabled={localRecords.length === 0}>
            全部回网合并（{localRecords.length}）
          </button>
        </div>
      </div>

      {!state.online && (
        <div className="notice warn">当前断网，蹄铁师在本地登记草稿。回网后按记录号合并。</div>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>待合并</p>
            <h3>离线草稿（按记录号合并）</h3>
          </div>
        </div>
        {localRecords.length === 0 ? (
          <p className="muted">暂无离线草稿。蹄铁师在「修蹄记录」中离线登记后在此合并。</p>
        ) : (
          <div className="merge-list">
            {localRecords.map((r) => (
              <div key={r.id} className="merge-item">
                <div>
                  <code>{r.recordNo}</code>
                  <div className="muted">
                    {state.horses[r.horseId]?.name} · {r.date}
                  </div>
                </div>
                <div className="btn-row">
                  <button onClick={() => simulateFailure(r.recordNo)}>模拟合并失败</button>
                  <button className="primary" onClick={() => mergeLocal(r.recordNo)}>
                    合并
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {failedRecords.length > 0 && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>失败重试</p>
              <h3>从最后确认记录按原号重试</h3>
            </div>
          </div>
          <div className="merge-list">
            {failedRecords.map((r) => (
              <div key={r.id} className="merge-item failed">
                <div>
                  <code>{r.recordNo}</code>
                  <div className="muted">
                    最后确认记录：{r.basedOnRecordNo} · 已重试 {r.mergeAttempts} 次
                  </div>
                  <div className="muted">失败原因：{r.lastError || "网络中断"}</div>
                </div>
                <button className="primary" onClick={() => retryRecord(r.recordNo)}>
                  按原号重试
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {conflictRecords.length > 0 && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>冲突待处理</p>
              <h3>两边改同一蹄位 · 保留兽医安全值</h3>
            </div>
          </div>
          <div className="merge-list">
            {conflictRecords.map((r) => (
              <div key={r.id} className="merge-item conflict">
                <div>
                  <code>{r.recordNo}</code>
                  <div className="muted">{state.horses[r.horseId]?.name}</div>
                  <div className="conflict-pos">
                    {r.hooves.LF.pending && <span className="badge pend">{HOOF_LABELS.LF}</span>}
                    {r.hooves.RF.pending && <span className="badge pend">{HOOF_LABELS.RF}</span>}
                    {r.hooves.LH.pending && <span className="badge pend">{HOOF_LABELS.LH}</span>}
                    {r.hooves.RH.pending && <span className="badge pend">{HOOF_LABELS.RH}</span>}
                  </div>
                </div>
                <span className="muted">兽医安全值已保留，另一版待处理</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>合并日志</p>
            <h3>重试与合并记录</h3>
          </div>
        </div>
        {state.mergeLog.length === 0 ? (
          <p className="muted">暂无合并日志。</p>
        ) : (
          <div className="log-list">
            {state.mergeLog.map((log) => (
              <div key={log.id} className={"log-item " + log.result}>
                <span className="log-time">{new Date(log.time).toLocaleTimeString("zh-CN")}</span>
                <code>{log.recordNo}</code>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
