// 业务规则引擎：离线队列、按记录号合并、签字锁定、失效重算、越权拒绝、幂等换蹄计数
import {
  ActionResult,
  DB,
  HOOF_ORDER,
  HOOF_LABEL,
  HoofEntry,
  HoofPos,
  Horse,
  OutboxEntry,
  PendingConflict,
  RecheckNotice,
  ShoeRecord,
  VetOpinion,
} from "./types";

const STORAGE_KEY = "hxyfront-62011-db";

export const now = () => new Date().toLocaleString("zh-CN", { hour12: false });

const uid = () => Math.random().toString(36).slice(2, 9);

export function pushLog(db: DB, msg: string) {
  db.log.unshift(`[${now()}] ${msg}`);
  if (db.log.length > 120) db.log.length = 120;
}

export function loadDB(seed: () => DB): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    /* 损坏则重建 */
  }
  const db = seed();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  return db;
}

export function saveDB(db: DB) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function resetDB(seed: () => DB): DB {
  localStorage.removeItem(STORAGE_KEY);
  const db = seed();
  saveDB(db);
  return db;
}

// ---------- 查询辅助 ----------

export function findHorse(db: DB, horseId: string): Horse | undefined {
  return db.horses.find((h) => h.id === horseId);
}

export function findRecord(db: DB, recordNo: string): ShoeRecord | undefined {
  return db.records.find((r) => r.recordNo === recordNo);
}

export function recordsOfHorse(db: DB, horseId: string): ShoeRecord[] {
  return db.records
    .filter((r) => r.horseId === horseId)
    .sort((a, b) => (a.date === b.date ? a.recordNo.localeCompare(b.recordNo) : a.date.localeCompare(b.date)));
}

export function latestRecord(db: DB, horseId: string): ShoeRecord | undefined {
  const list = recordsOfHorse(db, horseId);
  return list[list.length - 1];
}

export function validOpinionOf(db: DB, recordNo: string): VetOpinion | undefined {
  return db.opinions.find((o) => o.recordNo === recordNo && o.valid);
}

export function openConflictsOf(db: DB, horseId: string): PendingConflict[] {
  return db.conflicts.filter((c) => c.horseId === horseId && c.status === "open");
}

export function ledgerOf(db: DB, horseId: string) {
  if (!db.shoeLedger[horseId]) db.shoeLedger[horseId] = { counted: [], changes: 0 };
  return db.shoeLedger[horseId];
}

const sameHoof = (a: HoofEntry, b: HoofEntry) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 基准号 ----------

export function backfillBaseline(db: DB, horseId: string): ActionResult {
  const horse = findHorse(db, horseId);
  if (!horse) return { ok: false, message: `马匹 ${horseId} 不存在` };
  if (horse.baselineNo) return { ok: false, message: `${horse.name} 已有基准号 ${horse.baselineNo}` };
  horse.baselineNo = `BASE-${horse.id.replace(/\D/g, "").padStart(3, "0")}-01`;
  horse.updatedAt = now();
  pushLog(db, `旧档案补齐基准号：${horse.name}(${horse.id}) → ${horse.baselineNo}，历史修蹄记录仍可查询`);
  return { ok: true, message: `已补齐基准号 ${horse.baselineNo}` };
}

// ---------- 档案变更 → 已签意见与通知立即失效重算 ----------

export function updateHorseProfile(
  db: DB,
  horseId: string,
  patch: Partial<Pick<Horse, "name" | "category" | "breed" | "age">>
): ActionResult {
  const horse = findHorse(db, horseId);
  if (!horse) return { ok: false, message: "马匹不存在" };
  Object.assign(horse, patch);
  horse.profileVersion += 1;
  horse.updatedAt = now();
  pushLog(db, `档案变更：${horse.name}(${horse.id}) 版本升至 v${horse.profileVersion}，已签意见与复查通知立即失效重算`);
  invalidateOpinions(db, (o) => o.horseId === horseId && o.valid, "档案变更，签字失效需重新确认");
  invalidateNotices(db, horseId, "档案变更，通知失效重算");
  recomputeNotices(db, horseId);
  return { ok: true, message: "档案已更新，相关签字与通知已失效重算" };
}

function invalidateOpinions(db: DB, pred: (o: VetOpinion) => boolean, reason: string) {
  for (const o of db.opinions) {
    if (pred(o)) {
      o.valid = false;
      o.invalidReason = reason;
      const rec = findRecord(db, o.recordNo);
      if (rec && rec.plan.locked) {
        rec.plan.locked = false;
        rec.plan.lockedBy = undefined;
        rec.plan.lockedAt = undefined;
        pushLog(db, `记录 ${o.recordNo} 的蹄位方案随签字失效而解锁，需兽医重新签字`);
      }
    }
  }
}

function invalidateNotices(db: DB, horseId: string, reason: string) {
  for (const n of db.notices) {
    if (n.horseId === horseId && n.valid) {
      n.valid = false;
      n.invalidReason = reason;
    }
  }
}

// ---------- 复查通知：未处置冲突不生成 ----------

export function recomputeNotices(db: DB, horseId: string) {
  const latest = latestRecord(db, horseId);
  if (!latest || !latest.nextCheckDate) return;
  const open = openConflictsOf(db, horseId);
  if (open.length > 0) {
    invalidateNotices(db, horseId, "存在待处理合并冲突，暂不生成复查通知");
    pushLog(db, `${horseId} 有 ${open.length} 处合并冲突未处置，不生成复查通知`);
    return;
  }
  const exists = db.notices.some((n) => n.valid && n.recordNo === latest.recordNo && n.dueDate === latest.nextCheckDate);
  if (!exists) {
    const notice: RecheckNotice = {
      id: uid(),
      horseId,
      recordNo: latest.recordNo,
      dueDate: latest.nextCheckDate,
      createdAt: now(),
      valid: true,
    };
    db.notices.push(notice);
    pushLog(db, `生成复查通知：${horseId} 应于 ${latest.nextCheckDate} 复查（依据 ${latest.recordNo}）`);
  }
}

// ---------- 蹄铁师场边登记（离线入队） ----------

export function nextRecordNo(db: DB): string {
  db.seq += 1;
  return `R-2026-${String(db.seq).padStart(4, "0")}`;
}

export function queueFarrierRecord(
  db: DB,
  input: Omit<ShoeRecord, "recordNo" | "version" | "confirmedAt" | "origin">
): ActionResult {
  const horse = findHorse(db, input.horseId);
  if (!horse) return { ok: false, message: "马匹不存在" };
  const recordNo = nextRecordNo(db);
  const record: ShoeRecord = {
    ...input,
    recordNo,
    origin: "field",
    version: 1,
    confirmedAt: "",
  };
  db.outbox.push({
    id: uid(),
    kind: "create",
    recordNo,
    horseId: input.horseId,
    baseVersion: 0,
    record,
    createdAt: now(),
    status: "queued",
  });
  pushLog(db, `场边离线登记 ${recordNo}（${horse.name} 四蹄方案），已入待同步队列`);
  return { ok: true, message: `已离线登记 ${recordNo}，回网后按记录号合并` };
}

export function queueFarrierUpdate(db: DB, recordNo: string, hoof: HoofPos, entry: HoofEntry): ActionResult {
  const central = findRecord(db, recordNo);
  if (!central) return { ok: false, message: `中心库无记录 ${recordNo}` };
  if (central.plan.locked) {
    pushLog(db, `越权拒绝：${recordNo} ${HOOF_LABEL[hoof]}方案已锁定，场边修改须凭兽医签字，已拒绝入队`);
    return { ok: false, message: "越权拒绝：该蹄位方案已锁定，需兽医签字" };
  }
  db.outbox.push({
    id: uid(),
    kind: "update",
    recordNo,
    horseId: central.horseId,
    baseVersion: central.version,
    baseHooves: structuredClone(central.plan.hooves),
    changes: { [hoof]: entry },
    createdAt: now(),
    status: "queued",
  });
  pushLog(db, `场边离线修改 ${recordNo} ${HOOF_LABEL[hoof]}，已入待同步队列（基准版本 v${central.version}）`);
  return { ok: true, message: "已入离线队列，回网后合并" };
}

// ---------- 诊室侧修改（中心库直改；锁定蹄位须验签） ----------

export function clinicUpdateHoof(
  db: DB,
  recordNo: string,
  hoof: HoofPos,
  patch: Partial<HoofEntry>,
  signature: string
): ActionResult {
  const rec = findRecord(db, recordNo);
  if (!rec) return { ok: false, message: "记录不存在" };
  if (rec.plan.locked) {
    const opinion = validOpinionOf(db, recordNo);
    if (!opinion || !signature || opinion.signature !== signature.trim()) {
      pushLog(db, `越权拒绝：试图绕过签字修改 ${recordNo} 已锁定的${HOOF_LABEL[hoof]}，操作被拒绝并记录`);
      return { ok: false, message: "越权拒绝：蹄位方案已锁定，须出示兽医有效签字" };
    }
  }
  Object.assign(rec.plan.hooves[hoof], patch);
  rec.version += 1;
  pushLog(db, `诊室调整 ${recordNo} ${HOOF_LABEL[hoof]}（v${rec.version}）`);
  return { ok: true, message: "诊室修改已生效" };
}

export function updateNextCheckDate(db: DB, recordNo: string, date: string): ActionResult {
  const rec = findRecord(db, recordNo);
  if (!rec) return { ok: false, message: "记录不存在" };
  rec.nextCheckDate = date;
  rec.version += 1;
  pushLog(db, `复查日期变更：${recordNo} → ${date}，已签意见与通知立即失效重算`);
  invalidateOpinions(db, (o) => o.recordNo === recordNo && o.valid, "复查日期变更，签字失效需重新确认");
  invalidateNotices(db, rec.horseId, "复查日期变更，通知失效重算");
  recomputeNotices(db, rec.horseId);
  return { ok: true, message: "复查日期已更新，签字与通知已失效重算" };
}

// ---------- 兽医签字：确认疼痛评分后蹄位方案锁定 ----------

export function signRecord(db: DB, recordNo: string, vet: string, signature: string, comment: string): ActionResult {
  const rec = findRecord(db, recordNo);
  if (!rec) return { ok: false, message: "记录不存在" };
  const horse = findHorse(db, rec.horseId);
  if (!horse) return { ok: false, message: "马匹不存在" };
  if (!vet.trim() || !signature.trim()) return { ok: false, message: "兽医姓名与签字口令必填" };
  const painScores = Object.fromEntries(HOOF_ORDER.map((h) => [h, rec.plan.hooves[h].painScore])) as VetOpinion["painScores"];
  const opinion: VetOpinion = {
    id: uid(),
    recordNo,
    horseId: rec.horseId,
    vet: vet.trim(),
    signature: signature.trim(),
    painScores,
    comment: comment.trim(),
    signedAt: now(),
    profileVersion: horse.profileVersion,
    nextCheckDate: rec.nextCheckDate,
    valid: true,
  };
  db.opinions.push(opinion);
  rec.plan.locked = true;
  rec.plan.lockedBy = opinion.vet;
  rec.plan.lockedAt = opinion.signedAt;
  pushLog(db, `兽医 ${opinion.vet} 签字确认 ${recordNo} 四蹄疼痛评分，蹄位方案锁定`);
  return { ok: true, message: "已签字，蹄位方案锁定" };
}

// ---------- 换蹄计数：按记录号幂等，重试不重复计入 ----------

function countShoeChange(db: DB, record: ShoeRecord) {
  const ledger = ledgerOf(db, record.horseId);
  if (ledger.counted.includes(record.recordNo)) {
    pushLog(db, `${record.recordNo} 已计入换蹄账本，重试不重复计入`);
    return;
  }
  const prev = recordsOfHorse(db, record.horseId)
    .filter((r) => r.recordNo !== record.recordNo && (r.date < record.date || (r.date === record.date && r.recordNo < record.recordNo)))
    .pop();
  const changed = prev
    ? HOOF_ORDER.some((h) => rShoe(record, h) !== rShoe(prev, h))
    : true; // 首次修蹄计入一次装蹄
  ledger.counted.push(record.recordNo);
  if (changed) {
    ledger.changes += 1;
    pushLog(db, `换蹄计数：${record.horseId} 依据 ${record.recordNo} 计入 1 次（累计 ${ledger.changes}）`);
  } else {
    pushLog(db, `${record.recordNo} 蹄铁类型未变，计入账本但不增加换蹄次数`);
  }
}

const rShoe = (r: ShoeRecord, h: HoofPos) => r.plan.hooves[h].shoeType;

// ---------- 回网合并：按记录号；冲突保留兽医安全值，另一版待处理 ----------

export function syncMerge(db: DB): ActionResult {
  if (db.connectivity === "offline") {
    return { ok: false, message: "仍在断网（场边模式），请先回网" };
  }
  if (db.outbox.length === 0) return { ok: false, message: "离线队列为空，无待合并记录" };

  const queue = [...db.outbox].sort((a, b) => a.recordNo.localeCompare(b.recordNo));
  let merged = 0;

  for (const entry of queue) {
    const horse = findHorse(db, entry.horseId);
    if (!horse) {
      entry.status = "failed";
      entry.failReason = "马匹档案不存在";
      pushLog(db, `合并失败：${entry.recordNo} 对应档案 ${entry.horseId} 不存在；从最后确认记录 ${db.lastConfirmedNo ?? "无"} 起按原号重试`);
      return { ok: false, message: `合并失败：${entry.recordNo} 档案缺失，可从 ${db.lastConfirmedNo ?? "队首"} 重试` };
    }
    if (!horse.baselineNo) {
      entry.status = "failed";
      entry.failReason = "旧档案缺基准号";
      pushLog(db, `合并失败：${entry.recordNo} 对应 ${horse.name} 缺基准号，请先补齐；将从最后确认记录 ${db.lastConfirmedNo ?? "无"} 起按原号重试`);
      return { ok: false, message: `合并失败：${horse.name} 缺基准号，请先补齐后重试` };
    }

    if (entry.kind === "create") {
      if (findRecord(db, entry.recordNo)) {
        pushLog(db, `按原号重试：${entry.recordNo} 已确认，跳过重复合并，换蹄次数不重复计入`);
        removeOutbox(db, entry);
        merged += 1;
        continue;
      }
      const rec = structuredClone(entry.record!) as ShoeRecord;
      rec.confirmedAt = now();
      db.records.push(rec);
      countShoeChange(db, rec);
      db.lastConfirmedNo = rec.recordNo;
      removeOutbox(db, entry);
      merged += 1;
      pushLog(db, `合并成功：${rec.recordNo}（${horse.name}）已确认入库`);
      recomputeNotices(db, rec.horseId);
      continue;
    }

    // kind = update：与中心库按蹄位做三方对比
    const central = findRecord(db, entry.recordNo);
    if (!central) {
      entry.status = "failed";
      entry.failReason = "中心库无此记录号";
      pushLog(db, `合并失败：中心库无 ${entry.recordNo}；从最后确认记录 ${db.lastConfirmedNo ?? "无"} 起按原号重试`);
      return { ok: false, message: `合并失败：中心库无 ${entry.recordNo}` };
    }
    if (central.plan.locked) {
      pushLog(db, `越权拒绝：${entry.recordNo} 蹄位方案已锁定，场边离线修改无兽医签字，合并拒绝`);
      removeOutbox(db, entry);
      continue;
    }
    const base = entry.baseHooves!;
    let conflicted = 0;
    for (const h of HOOF_ORDER) {
      const farrierVal = entry.changes?.[h];
      if (!farrierVal) continue;
      const clinicVal = central.plan.hooves[h];
      const clinicTouched = !sameHoof(clinicVal, base[h]);
      if (!clinicTouched) {
        central.plan.hooves[h] = farrierVal;
      } else if (sameHoof(clinicVal, farrierVal)) {
        // 两边改成一样，无需处理
      } else {
        // 同一蹄位两边都改：保留兽医安全值，场边版本转待处理
        central.plan.hooves[h] = { ...clinicVal, painScore: clinicVal.painScore };
        const conflict: PendingConflict = {
          id: uid(),
          recordNo: central.recordNo,
          horseId: central.horseId,
          hoof: h,
          kept: structuredClone(clinicVal),
          rival: structuredClone(farrierVal),
          createdAt: now(),
          status: "open",
        };
        db.conflicts.push(conflict);
        conflicted += 1;
        pushLog(db, `合并冲突：${central.recordNo} ${HOOF_LABEL[h]} 两边都改，保留兽医安全值(疼痛${clinicVal.painScore}分)，场边版本转待处理`);
      }
    }
    central.version += 1;
    countShoeChange(db, central);
    db.lastConfirmedNo = central.recordNo;
    removeOutbox(db, entry);
    merged += 1;
    pushLog(db, conflicted > 0 ? `合并完成：${central.recordNo} 带 ${conflicted} 处待处理冲突` : `合并成功：${central.recordNo} 场边修改已并入（v${central.version}）`);
    recomputeNotices(db, central.horseId);
  }

  return { ok: true, message: `合并完成，共确认 ${merged} 条，最后确认记录 ${db.lastConfirmedNo ?? "无"}` };
}

function removeOutbox(db: DB, entry: OutboxEntry) {
  db.outbox = db.outbox.filter((e) => e.id !== entry.id);
}

/** 合并失败后从最后确认记录按原号重试（幂等） */
export function retryMerge(db: DB): ActionResult {
  for (const e of db.outbox) {
    if (e.status === "failed") {
      e.status = "queued";
      e.failReason = undefined;
    }
  }
  pushLog(db, `从最后确认记录 ${db.lastConfirmedNo ?? "队首"} 起按原号重试合并，换蹄计数次要账本保证不重复计入`);
  return syncMerge(db);
}

// ---------- 冲突处置 ----------

export function resolveConflict(db: DB, conflictId: string, choice: "keep" | "apply-rival"): ActionResult {
  const c = db.conflicts.find((x) => x.id === conflictId);
  if (!c || c.status !== "open") return { ok: false, message: "冲突不存在或已处置" };
  const rec = findRecord(db, c.recordNo);
  if (choice === "apply-rival" && rec) {
    // 采纳场边版本，但疼痛评分仍保留兽医安全值
    rec.plan.hooves[c.hoof] = { ...c.rival, painScore: c.kept.painScore };
    rec.version += 1;
    c.resolution = "采纳场边版本（疼痛评分保留兽医安全值）";
    pushLog(db, `冲突处置：${c.recordNo} ${HOOF_LABEL[c.hoof]} 采纳场边版本，疼痛评分保留兽医安全值 ${c.kept.painScore} 分`);
  } else {
    c.resolution = "维持诊室版本";
    pushLog(db, `冲突处置：${c.recordNo} ${HOOF_LABEL[c.hoof]} 维持诊室版本（兽医安全值）`);
  }
  c.status = "resolved";
  recomputeNotices(db, c.horseId);
  return { ok: true, message: "冲突已处置" };
}

// ---------- 连通性 ----------

export function setConnectivity(db: DB, mode: "online" | "offline") {
  db.connectivity = mode;
  pushLog(db, mode === "offline" ? "已切换到场边断网模式，登记进入离线队列" : "已回网，可执行按记录号合并");
}
