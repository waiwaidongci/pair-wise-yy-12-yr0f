import { useMemo, useState } from "react";
import "./styles.css";
import {
  ActionResult,
  DB,
  HOOF_LABEL,
  HOOF_ORDER,
  HoofEntry,
  HoofPos,
} from "./types";
import {
  backfillBaseline,
  clinicUpdateHoof,
  findHorse,
  findRecord,
  latestRecord,
  loadDB,
  openConflictsOf,
  queueFarrierRecord,
  queueFarrierUpdate,
  recordsOfHorse,
  recomputeNotices,
  resetDB,
  resolveConflict,
  retryMerge,
  saveDB,
  setConnectivity,
  signRecord,
  syncMerge,
  updateHorseProfile,
  updateNextCheckDate,
  validOpinionOf,
} from "./store";
import { seedDB } from "./seed";

const emptyHoof = (): HoofEntry => ({
  shape: "",
  shoeType: "",
  nails: "",
  painScore: 0,
  gaitIssue: "",
  abnormal: false,
});

const today = () => new Date().toISOString().slice(0, 10);

function daysUntil(date: string): number {
  return Math.ceil((new Date(date + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);
}

type Tab = "horses" | "records" | "vet" | "sync" | "notices" | "history";

const TABS: { key: Tab; label: string }[] = [
  { key: "horses", label: "马匹档案" },
  { key: "records", label: "修蹄记录" },
  { key: "vet", label: "兽医审核" },
  { key: "sync", label: "同步合并" },
  { key: "notices", label: "复查提醒" },
  { key: "history", label: "更换历史" },
];

function App() {
  const [db, setDb] = useState<DB>(() => loadDB(seedDB));
  const [tab, setTab] = useState<Tab>("sync");
  const [flash, setFlash] = useState<ActionResult | null>(null);

  const run = (fn: (draft: DB) => ActionResult | void) => {
    const draft = structuredClone(db);
    const res = fn(draft);
    saveDB(draft);
    setDb(draft);
    if (res) setFlash(res);
  };

  const metrics = useMemo(() => {
    const validNotices = db.notices.filter((n) => n.valid).length;
    const abnormal = db.horses.filter((h) => {
      const latest = latestRecord(db, h.id);
      return latest && HOOF_ORDER.some((p) => latest.plan.hooves[p].abnormal);
    }).length;
    const shoeChanges = Object.values(db.shoeLedger).reduce((s, l) => s + l.changes, 0);
    const openConflicts = db.conflicts.filter((c) => c.status === "open").length;
    return { validNotices, abnormal, shoeChanges, horses: db.horses.length, openConflicts, outbox: db.outbox.length };
  }, [db]);

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62011 · 马术蹄铁修整档案 · 离线协作</p>
        <h1>蹄铁师 × 兽医 离线协作台</h1>
        <span>
          蹄铁师场边断网登记四蹄蹄形、蹄铁与钉位；兽医诊室审核蹄病，签字确认疼痛评分后蹄位方案锁定。
          回网按记录号合并：同一蹄位两边都改时保留兽医安全值、另一版待处理，未处置不生成复查通知；
          档案或复查日期变化后已签意见与通知立即失效重算；合并失败从最后确认记录按原号重试，换蹄次数不重复计入。
        </span>
      </section>

      <section className="metrics">
        <article><small>待复查</small><strong>{metrics.validNotices}</strong></article>
        <article><small>异常步态</small><strong>{metrics.abnormal}</strong></article>
        <article><small>更换蹄铁</small><strong>{metrics.shoeChanges}</strong></article>
        <article><small>马匹档案</small><strong>{metrics.horses}</strong></article>
        <article className="warn"><small>待处理冲突</small><strong>{metrics.openConflicts}</strong></article>
        <article className="warn"><small>离线待同步</small><strong>{metrics.outbox}</strong></article>
      </section>

      <section className={`connbar ${db.connectivity}`}>
        <div>
          <b>{db.connectivity === "offline" ? "场边断网模式" : "已回网（诊室中心库）"}</b>
          <span>
            {db.connectivity === "offline"
              ? "登记与修改进入离线队列，回网后按记录号合并"
              : `可执行合并 · 最后确认记录 ${db.lastConfirmedNo ?? "无"}`}
          </span>
        </div>
        <div className="conn-actions">
          <button onClick={() => run((d) => setConnectivity(d, db.connectivity === "offline" ? "online" : "offline"))}>
            {db.connectivity === "offline" ? "回网" : "断网（去场边）"}
          </button>
          <button className="primary" disabled={db.connectivity === "offline"} onClick={() => run((d) => syncMerge(d))}>
            按记录号合并
          </button>
          <button onClick={() => { if (confirm("重置为初始演示数据？")) setDb(resetDB(seedDB)); }}>
            重置演示数据
          </button>
        </div>
      </section>

      {flash && (
        <div className={`flash ${flash.ok ? "ok" : "err"}`} onClick={() => setFlash(null)}>
          {flash.ok ? "✓ " : "✕ "}{flash.message}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "sync" && metrics.outbox > 0 && <em>{metrics.outbox}</em>}
            {t.key === "notices" && metrics.validNotices > 0 && <em>{metrics.validNotices}</em>}
          </button>
        ))}
      </nav>

      {tab === "horses" && <HorsesTab db={db} run={run} />}
      {tab === "records" && <RecordsTab db={db} run={run} />}
      {tab === "vet" && <VetTab db={db} run={run} />}
      {tab === "sync" && <SyncTab db={db} run={run} />}
      {tab === "notices" && <NoticesTab db={db} />}
      {tab === "history" && <HistoryTab db={db} />}
    </main>
  );
}

type Run = (fn: (draft: DB) => ActionResult | void) => void;

/* ---------------- 马匹档案 ---------------- */

function HorsesTab({ db, run }: { db: DB; run: Run }) {
  const [filter, setFilter] = useState("全部");
  const list = db.horses.filter((h) =>
    filter === "全部" ? true : filter === "缺基准号" ? !h.baselineNo : h.category === filter
  );
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>马匹列表</p>
          <h2>马匹档案</h2>
        </div>
        <div className="chips">
          {["全部", "运动马", "休养马", "缺基准号"].map((f) => (
            <button key={f} className={filter === f ? "chip-on" : ""} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="table">
        <div className="tr th">
          <span>编号 / 名字</span><span>类别</span><span>基准号</span><span>档案版本</span><span>操作</span>
        </div>
        {list.map((h) => (
          <HorseRow key={h.id} db={db} run={run} horseId={h.id} />
        ))}
      </div>
      <p className="hint">提示：修改档案会使该马所有已签意见与复查通知立即失效重算；旧档案缺基准号须先补齐才能合并新记录，历史修蹄仍可在「更换历史」查询。</p>
    </section>
  );
}

function HorseRow({ db, run, horseId }: { db: DB; run: Run; horseId: string }) {
  const h = findHorse(db, horseId)!;
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(h.category);
  const [breed, setBreed] = useState(h.breed);
  return (
    <div className="tr">
      <span><b>{h.id}</b> {h.name}<small className="sub">{h.breed} · {h.age}岁</small></span>
      <span>
        {editing ? (
          <select value={category} onChange={(e) => setCategory(e.target.value as "运动马" | "休养马")}>
            <option>运动马</option><option>休养马</option>
          </select>
        ) : h.category}
      </span>
      <span>
        {h.baselineNo ? <code>{h.baselineNo}</code> : <i className="badge bad">缺失</i>}
      </span>
      <span>v{h.profileVersion}</span>
      <span className="row-actions">
        {!h.baselineNo && (
          <button className="primary" onClick={() => run((d) => backfillBaseline(d, h.id))}>补齐基准号</button>
        )}
        {editing ? (
          <>
            <input value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="品种" />
            <button className="primary" onClick={() => { run((d) => updateHorseProfile(d, h.id, { category, breed })); setEditing(false); }}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}>修改档案</button>
        )}
      </span>
    </div>
  );
}

/* ---------------- 修蹄记录（蹄铁师） ---------------- */

function RecordsTab({ db, run }: { db: DB; run: Run }) {
  return (
    <>
      <FarrierForm db={db} run={run} />
      <section className="panel">
        <div className="heading">
          <div>
            <p>中心库已确认</p>
            <h2>四蹄对比记录</h2>
          </div>
        </div>
        <div className="records">
          {[...db.records]
            .sort((a, b) => b.recordNo.localeCompare(a.recordNo))
            .map((r) => (
              <RecordCard key={r.recordNo} db={db} run={run} recordNo={r.recordNo} />
            ))}
        </div>
      </section>
    </>
  );
}

function FarrierForm({ db, run }: { db: DB; run: Run }) {
  const [horseId, setHorseId] = useState("HORSE-31");
  const [farrier, setFarrier] = useState("赵铁柱");
  const [date, setDate] = useState(today());
  const [nextCheckDate, setNextCheckDate] = useState("2026-11-01");
  const [note, setNote] = useState("");
  const [hooves, setHooves] = useState<Record<HoofPos, HoofEntry>>({
    LF: emptyHoof(), RF: emptyHoof(), LH: emptyHoof(), RH: emptyHoof(),
  });

  const setH = (p: HoofPos, patch: Partial<HoofEntry>) =>
    setHooves((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));

  const fillSample = () => {
    setHooves({
      LF: { shape: "蹄形正常", shoeType: "铝蹄铁", nails: "6钉标准", painScore: 0, gaitIssue: "步态正常", abnormal: false },
      RF: { shape: "蹄踵略窄", shoeType: "铝蹄铁", nails: "6钉标准", painScore: 1, gaitIssue: "步态轻微不稳", abnormal: true },
      LH: { shape: "蹄形正常", shoeType: "普通铁", nails: "6钉标准", painScore: 0, gaitIssue: "步态正常", abnormal: false },
      RH: { shape: "蹄形正常", shoeType: "普通铁", nails: "6钉标准", painScore: 0, gaitIssue: "步态正常", abnormal: false },
    });
    setNote("右前蹄拍照归档，建议教练复核步态");
  };

  const submit = () => {
    run((d) =>
      queueFarrierRecord(d, {
        horseId,
        farrier,
        date,
        nextCheckDate,
        plan: { hooves: structuredClone(hooves), locked: false },
        note,
      })
    );
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>蹄铁师 · 场边断网登记</p>
          <h2>新增修蹄记录</h2>
        </div>
        <div className="row-actions">
          <button onClick={fillSample}>填充示例</button>
          <button className="primary" onClick={submit}>离线登记入队</button>
        </div>
      </div>
      <div className="field-grid cols-5">
        <label><span>马匹编号</span>
          <select value={horseId} onChange={(e) => setHorseId(e.target.value)}>
            {db.horses.map((h) => <option key={h.id} value={h.id}>{h.id} {h.name}</option>)}
          </select>
        </label>
        <label><span>蹄铁师</span><input value={farrier} onChange={(e) => setFarrier(e.target.value)} /></label>
        <label><span>修蹄日期</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>下次复查</span><input type="date" value={nextCheckDate} onChange={(e) => setNextCheckDate(e.target.value)} /></label>
        <label><span>照片备注</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="拍照备注" /></label>
      </div>
      <div className="hoof-grid">
        {HOOF_ORDER.map((p) => (
          <div key={p} className="hoof-card">
            <h3>{HOOF_LABEL[p]}</h3>
            <label><span>蹄形评估</span><input value={hooves[p].shape} onChange={(e) => setH(p, { shape: e.target.value })} placeholder="如：外侧磨耗" /></label>
            <label><span>蹄铁类型</span><input value={hooves[p].shoeType} onChange={(e) => setH(p, { shoeType: e.target.value })} placeholder="如：铝蹄铁" /></label>
            <label><span>钉位</span><input value={hooves[p].nails} onChange={(e) => setH(p, { nails: e.target.value })} placeholder="如：6钉标准" /></label>
            <label><span>疼痛评分 0-5</span>
              <input type="number" min={0} max={5} value={hooves[p].painScore}
                onChange={(e) => setH(p, { painScore: Math.max(0, Math.min(5, Number(e.target.value))) })} />
            </label>
            <label><span>步态问题</span><input value={hooves[p].gaitIssue} onChange={(e) => setH(p, { gaitIssue: e.target.value })} /></label>
            <label className="check">
              <input type="checkbox" checked={hooves[p].abnormal} onChange={(e) => setH(p, { abnormal: e.target.checked })} />
              <span>异常步态标记</span>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecordCard({ db, run, recordNo }: { db: DB; run: Run; recordNo: string }) {
  const r = findRecord(db, recordNo)!;
  const h = findHorse(db, r.horseId);
  const opinion = validOpinionOf(db, recordNo);
  const [editDate, setEditDate] = useState(false);
  const [dateVal, setDateVal] = useState(r.nextCheckDate);
  const [farrierHoof, setFarrierHoof] = useState<HoofPos>("RF");

  const tryFarrierUpdate = () => {
    run((d) => {
      const cur = findRecord(d, recordNo)!.plan.hooves[farrierHoof];
      return queueFarrierUpdate(d, recordNo, farrierHoof, {
        ...cur,
        shape: cur.shape ? cur.shape + "（场边复测）" : "场边复测",
        shoeType: "铝蹄铁",
      });
    });
  };

  return (
    <article className="record-card">
      <div className="record-head">
        <b>{r.recordNo}</b>
        <div>
          <h3>{h?.name}（{r.horseId}） · {r.date} 修蹄</h3>
          <p>
            蹄铁师 {r.farrier} · 下次复查 {r.nextCheckDate} · v{r.version} · {r.origin === "field" ? "场边登记" : "诊室登记"}
            {r.note && ` · ${r.note}`}
          </p>
        </div>
        <div className="badges">
          {r.plan.locked
            ? <i className="badge lock">🔒 已锁定 · {r.plan.lockedBy}</i>
            : <i className="badge open">未锁定</i>}
          {opinion && <i className="badge ok">兽医签字有效</i>}
        </div>
      </div>
      <div className="hoof-grid readonly">
        {HOOF_ORDER.map((p) => {
          const e = r.plan.hooves[p];
          return (
            <div key={p} className={`hoof-card ${e.abnormal ? "abnormal" : ""}`}>
              <h3>{HOOF_LABEL[p]}{e.abnormal && <i className="badge bad">异常步态</i>}</h3>
              <p>蹄形：{e.shape || "—"}</p>
              <p>蹄铁：{e.shoeType || "—"} · 钉位：{e.nails || "—"}</p>
              <p>疼痛评分：<b className={e.painScore >= 3 ? "pain-high" : ""}>{e.painScore}</b> / 5 · {e.gaitIssue || "—"}</p>
            </div>
          );
        })}
      </div>
      <div className="record-actions">
        <span className="sub">场边离线修改：</span>
        <select value={farrierHoof} onChange={(e) => setFarrierHoof(e.target.value as HoofPos)}>
          {HOOF_ORDER.map((p) => <option key={p} value={p}>{HOOF_LABEL[p]}</option>)}
        </select>
        <button onClick={tryFarrierUpdate}>离线修改入队</button>
        {editDate ? (
          <>
            <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
            <button className="primary" onClick={() => { run((d) => updateNextCheckDate(d, recordNo, dateVal)); setEditDate(false); }}>保存复查日期</button>
          </>
        ) : (
          <button onClick={() => { setDateVal(r.nextCheckDate); setEditDate(true); }}>修改复查日期</button>
        )}
        {r.plan.locked && <span className="sub warn-text">锁定蹄位：无兽医签字的修改将按越权拒绝</span>}
      </div>
    </article>
  );
}

/* ---------------- 兽医审核 ---------------- */

function VetTab({ db, run }: { db: DB; run: Run }) {
  const unsigned = db.records.filter((r) => !validOpinionOf(db, r.recordNo));
  return (
    <>
      <section className="panel">
        <div className="heading">
          <div>
            <p>诊室 · 蹄病审核</p>
            <h2>待签字记录（{unsigned.length}）</h2>
          </div>
        </div>
        {unsigned.length === 0 && <p className="hint">暂无待签字记录。</p>}
        {unsigned.map((r) => (
          <SignForm key={r.recordNo} db={db} run={run} recordNo={r.recordNo} />
        ))}
      </section>

      <ClinicAdjust db={db} run={run} />

      <section className="panel">
        <div className="heading">
          <div>
            <p>兽医意见</p>
            <h2>已签意见（{db.opinions.length}）</h2>
          </div>
        </div>
        <div className="records">
          {db.opinions.map((o) => (
            <article key={o.id} className="opinion">
              <div>
                <h3>
                  {o.recordNo} · 兽医 {o.vet}
                  {o.valid ? <i className="badge ok">有效</i> : <i className="badge bad">已失效</i>}
                </h3>
                <p>
                  确认疼痛评分：{HOOF_ORDER.map((p) => `${HOOF_LABEL[p]} ${o.painScores[p]}分`).join("，")}
                  · 签字口令 <code>{o.signature}</code> · {o.signedAt}
                </p>
                {o.comment && <p>意见：{o.comment}</p>}
                {!o.valid && <p className="warn-text">失效原因：{o.invalidReason}（档案 v{o.profileVersion} / 复查 {o.nextCheckDate} 时签署）</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function SignForm({ db, run, recordNo }: { db: DB; run: Run; recordNo: string }) {
  const r = findRecord(db, recordNo)!;
  const h = findHorse(db, r.horseId);
  const [vet, setVet] = useState("林岚");
  const [signature, setSignature] = useState("");
  const [comment, setComment] = useState("");
  return (
    <div className="sign-form">
      <div className="sign-head">
        <b>{r.recordNo}</b>
        <span>{h?.name}（{r.horseId}）· 当前疼痛评分：{HOOF_ORDER.map((p) => `${HOOF_LABEL[p]} ${r.plan.hooves[p].painScore}分`).join("，")}</span>
      </div>
      <div className="field-grid cols-4">
        <label><span>兽医姓名</span><input value={vet} onChange={(e) => setVet(e.target.value)} /></label>
        <label><span>签字口令</span><input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={`如 VET-LIN-${recordNo.slice(-4)}`} /></label>
        <label><span>审核意见</span><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="蹄病诊断与方案确认" /></label>
        <label><span>&nbsp;</span>
          <button className="primary" onClick={() => run((d) => signRecord(d, recordNo, vet, signature, comment))}>
            签字确认疼痛评分并锁定
          </button>
        </label>
      </div>
    </div>
  );
}

function ClinicAdjust({ db, run }: { db: DB; run: Run }) {
  const [recordNo, setRecordNo] = useState("R-2026-0002");
  const [hoofPos, setHoofPos] = useState<HoofPos>("LH");
  const [shoeType, setShoeType] = useState("加护蹄垫");
  const [painScore, setPainScore] = useState(2);
  const [signature, setSignature] = useState("");
  const rec = findRecord(db, recordNo);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>诊室直改中心库</p>
          <h2>诊室调整（锁定蹄位须验签）</h2>
        </div>
      </div>
      <div className="field-grid cols-5">
        <label><span>记录号</span>
          <select value={recordNo} onChange={(e) => setRecordNo(e.target.value)}>
            {db.records.map((r) => <option key={r.recordNo} value={r.recordNo}>{r.recordNo}{r.plan.locked ? " 🔒" : ""}</option>)}
          </select>
        </label>
        <label><span>蹄位</span>
          <select value={hoofPos} onChange={(e) => setHoofPos(e.target.value as HoofPos)}>
            {HOOF_ORDER.map((p) => <option key={p} value={p}>{HOOF_LABEL[p]}</option>)}
          </select>
        </label>
        <label><span>蹄铁类型</span><input value={shoeType} onChange={(e) => setShoeType(e.target.value)} /></label>
        <label><span>疼痛评分（安全值）</span>
          <input type="number" min={0} max={5} value={painScore}
            onChange={(e) => setPainScore(Math.max(0, Math.min(5, Number(e.target.value))))} />
        </label>
        <label><span>兽医签字口令{rec?.plan.locked ? "（必填）" : "（可空）"}</span>
          <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="已锁定记录须出示签字" />
        </label>
      </div>
      <div className="row-actions">
        <button className="primary" onClick={() => run((d) => clinicUpdateHoof(d, recordNo, hoofPos, { shoeType, painScore }, signature))}>
          提交诊室调整
        </button>
        <span className="hint">提示：R-2026-0002 已锁定，口令 VET-LIN-0002；输错或留空将按越权拒绝。</span>
      </div>
    </section>
  );
}

/* ---------------- 同步合并 ---------------- */

function SyncTab({ db, run }: { db: DB; run: Run }) {
  const open = db.conflicts.filter((c) => c.status === "open");
  const resolved = db.conflicts.filter((c) => c.status === "resolved");
  return (
    <>
      <section className="panel">
        <div className="heading">
          <div>
            <p>场边离线队列</p>
            <h2>待同步（{db.outbox.length}）</h2>
          </div>
          <div className="row-actions">
            <button className="primary" disabled={db.connectivity === "offline" || db.outbox.length === 0}
              onClick={() => run((d) => syncMerge(d))}>按记录号合并</button>
            <button disabled={db.connectivity === "offline" || db.outbox.length === 0}
              onClick={() => run((d) => retryMerge(d))}>从最后确认记录按原号重试</button>
          </div>
        </div>
        {db.outbox.length === 0 && <p className="hint">离线队列为空。</p>}
        <div className="table">
          {db.outbox.map((e) => (
            <div className="tr" key={e.id}>
              <span><b>{e.recordNo}</b><small className="sub">{e.kind === "create" ? "新建" : "修改"} · {e.createdAt}</small></span>
              <span>{e.horseId}</span>
              <span>{e.kind === "update" ? `基准 v${e.baseVersion} · 改 ${Object.keys(e.changes ?? {}).map((k) => HOOF_LABEL[k as HoofPos]).join("、")}` : "整记录"}</span>
              <span>{e.status === "failed" ? <i className="badge bad">失败：{e.failReason}</i> : <i className="badge open">排队中</i>}</span>
            </div>
          ))}
        </div>
        <p className="hint">演示路径：① 点「回网」→「按记录号合并」：R-2026-0001 右前蹄两边都改 → 保留兽医安全值、场边版转待处理；② R-2026-0003 因老骥缺基准号合并失败 → 到「马匹档案」补齐基准号 → 点「按原号重试」，换蹄次数不重复计入。</p>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>同一蹄位两边都改</p>
            <h2>待处理冲突（{open.length}）</h2>
          </div>
        </div>
        {open.length === 0 && <p className="hint">暂无待处理冲突。存在未处置冲突时，对应马匹不生成复查通知。</p>}
        {open.map((c) => (
          <div key={c.id} className="conflict">
            <div className="conflict-head">
              <b>{c.recordNo} · {HOOF_LABEL[c.hoof]}</b>
              <span className="sub">{findHorse(db, c.horseId)?.name}（{c.horseId}）· {c.createdAt}</span>
            </div>
            <div className="conflict-cols">
              <div className="conflict-col kept">
                <h4>已保留 · 诊室版（兽医安全值）</h4>
                <p>蹄形：{c.kept.shape} · 蹄铁：{c.kept.shoeType}</p>
                <p>钉位：{c.kept.nails} · 疼痛评分：<b>{c.kept.painScore}</b></p>
              </div>
              <div className="conflict-col rival">
                <h4>待处理 · 场边版</h4>
                <p>蹄形：{c.rival.shape} · 蹄铁：{c.rival.shoeType}</p>
                <p>钉位：{c.rival.nails} · 疼痛评分：<b>{c.rival.painScore}</b></p>
              </div>
            </div>
            <div className="row-actions">
              <button onClick={() => run((d) => resolveConflict(d, c.id, "keep"))}>维持诊室版本</button>
              <button className="primary" onClick={() => run((d) => resolveConflict(d, c.id, "apply-rival"))}>
                采纳场边版本（疼痛评分仍保留兽医安全值）
              </button>
            </div>
          </div>
        ))}
        {resolved.length > 0 && (
          <div className="records">
            {resolved.map((c) => (
              <article key={c.id} className="opinion">
                <p>✓ {c.recordNo} {HOOF_LABEL[c.hoof]}：{c.resolution}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>协作事件</p>
            <h2>合并与审计日志</h2>
          </div>
        </div>
        <div className="log">
          {db.log.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      </section>
    </>
  );
}

/* ---------------- 复查提醒 ---------------- */

function NoticesTab({ db }: { db: DB }) {
  const valid = db.notices.filter((n) => n.valid);
  const invalid = db.notices.filter((n) => !n.valid);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>复查计划</p>
          <h2>复查提醒（{valid.length}）</h2>
        </div>
      </div>
      <div className="records">
        {valid.length === 0 && <p className="hint">暂无有效复查通知。存在未处置合并冲突时不生成通知。</p>}
        {valid
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((n) => {
            const h = findHorse(db, n.horseId);
            const d = daysUntil(n.dueDate);
            return (
              <article key={n.id} className="notice">
                <b className={d <= 3 ? "due-soon" : ""}>{d < 0 ? `逾期${-d}天` : d === 0 ? "今日" : `${d}天后`}</b>
                <div>
                  <h3>{h?.name}（{n.horseId}） · {n.dueDate} 复查</h3>
                  <p>依据记录 {n.recordNo} · 生成于 {n.createdAt}</p>
                </div>
              </article>
            );
          })}
      </div>
      {invalid.length > 0 && (
        <>
          <h3 className="sub-title">已失效通知（档案/复查日期变化或冲突未处置）</h3>
          <div className="records">
            {invalid.map((n) => (
              <article key={n.id} className="notice invalid">
                <b>失效</b>
                <div>
                  <h3>{n.horseId} · 原 {n.dueDate} 复查</h3>
                  <p>{n.invalidReason}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {db.horses.some((h) => openConflictsOf(db, h.id).length > 0) && (
        <p className="hint warn-text">
          {db.horses.filter((h) => openConflictsOf(db, h.id).length > 0).map((h) => h.name).join("、")}
          存在未处置合并冲突，复查通知暂不生成。
        </p>
      )}
    </section>
  );
}

/* ---------------- 蹄铁更换历史 ---------------- */

function HistoryTab({ db }: { db: DB }) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>蹄铁更换历史</p>
          <h2>按马匹查询（含旧档案）</h2>
        </div>
      </div>
      {db.horses.map((h) => {
        const records = recordsOfHorse(db, h.id);
        const ledger = db.shoeLedger[h.id] ?? { counted: [], changes: 0 };
        return (
          <div key={h.id} className="history-block">
            <div className="history-head">
              <h3>
                {h.name}（{h.id}）
                {h.baselineNo ? <code>{h.baselineNo}</code> : <i className="badge bad">缺基准号 · 历史仍可查</i>}
              </h3>
              <span className="sub">换蹄次数 {ledger.changes} · 已计入账本 {ledger.counted.length} 条（重试不重复计入）</span>
            </div>
            {records.length === 0 && <p className="hint">暂无修蹄记录。</p>}
            <div className="table">
              {records.map((r) => (
                <div className="tr" key={r.recordNo}>
                  <span><b>{r.recordNo}</b><small className="sub">{r.date} · {r.farrier}</small></span>
                  <span>{HOOF_ORDER.map((p) => `${HOOF_LABEL[p]} ${r.plan.hooves[p].shoeType || "—"}`).join(" / ")}</span>
                  <span>{r.plan.locked ? <i className="badge lock">🔒</i> : <i className="badge open">未锁定</i>}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default App;
