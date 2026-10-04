import { useState } from "react";
import { useStore } from "../domain/store";
import { hoofChangeCount } from "../domain/engine";

export function HorsesTab() {
  const { state, addHorse, updateHorse, supplementBaselines } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    breed: "",
    status: "运动马" as const,
    gaitIssue: "",
    abnormalGait: false,
    note: "",
  });

  const horses = Object.values(state.horses);
  const missingBaseline = horses.filter((h) => h.baselineMissing || !h.baselineNo);

  const submit = () => {
    if (!form.name.trim()) return;
    addHorse(form);
    setForm({ name: "", breed: "", status: "运动马", gaitIssue: "", abnormalGait: false, note: "" });
    setShowForm(false);
  };

  return (
    <div className="tab-panel">
      <div className="heading">
        <div>
          <p>马匹档案</p>
          <h2>马匹列表与基准号</h2>
        </div>
        <div className="btn-row">
          {missingBaseline.length > 0 && (
            <button className="primary" onClick={supplementBaselines}>
              补齐基准号（{missingBaseline.length}）
            </button>
          )}
          <button onClick={() => setShowForm((v) => !v)}>新增马匹</button>
        </div>
      </div>

      {missingBaseline.length > 0 && (
        <div className="notice warn">
          有 {missingBaseline.length} 份旧档案缺基准号，历史修蹄记录仍可查询。请先补齐基准号再合并。
        </div>
      )}

      {showForm && (
        <div className="panel form-inline">
          <h3>新增马匹</h3>
          <div className="field-grid">
            <label>
              <span>马匹编号</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 HORSE-32"
              />
            </label>
            <label>
              <span>品种</span>
              <input
                value={form.breed}
                onChange={(e) => setForm({ ...form, breed: e.target.value })}
                placeholder="如 温血马"
              />
            </label>
            <label>
              <span>状态</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as "运动马" | "休养马" })}
              >
                <option value="运动马">运动马</option>
                <option value="休养马">休养马</option>
              </select>
            </label>
            <label>
              <span>步态问题</span>
              <input
                value={form.gaitIssue}
                onChange={(e) => setForm({ ...form, gaitIssue: e.target.value })}
                placeholder="如 右前蹄外侧磨耗"
              />
            </label>
            <label className="check-label">
              <span>异常步态标记</span>
              <input
                type="checkbox"
                checked={form.abnormalGait}
                onChange={(e) => setForm({ ...form, abnormalGait: e.target.checked })}
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
          <div className="btn-row">
            <button className="primary" onClick={submit}>
              保存档案
            </button>
            <button onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="horse-grid">
        {horses.map((h) => {
          const count = hoofChangeCount(state, h.id);
          return (
            <article key={h.id} className="horse-card">
              <div className="horse-head">
                <h3>{h.name}</h3>
                <span className={"status-pill " + (h.status === "运动马" ? "active" : "rest")}>
                  {h.status}
                </span>
              </div>
              <div className="horse-meta">
                <span>基准号：</span>
                {h.baselineMissing || !h.baselineNo ? (
                  <span className="badge invalid">待补齐</span>
                ) : (
                  <code>{h.baselineNo}</code>
                )}
              </div>
              <p className="horse-gait">
                步态：{h.gaitIssue || "正常"}
                {h.abnormalGait && <span className="badge pend">异常</span>}
              </p>
              <p className="horse-note">{h.note}</p>
              <div className="horse-foot">
                <span>累计换蹄</span>
                <strong>{count}</strong>
                <span className="muted">次（仅计已确认）</span>
              </div>
              <button
                className="link-btn"
                onClick={() => updateHorse(h.id, { abnormalGait: !h.abnormalGait })}
              >
                {h.abnormalGait ? "取消异常标记" : "标记异常步态"}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
