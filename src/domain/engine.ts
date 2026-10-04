// 合并引擎：离线记录按记录号合并、蹄位锁定、失效重算、失败重试、基准号补齐、越权拒绝
import {
  AppState,
  ConflictInfo,
  HoofPosition,
  HoofRecord,
  HoofPositionState,
  HOOF_POSITIONS,
  ReviewNotification,
  VetOpinion,
} from "./types";

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyHoof(): HoofPositionState {
  return {
    shape: "",
    ironType: "",
    nailPositions: "",
    painScore: null,
    vetSigned: false,
    locked: false,
    safetyValue: false,
    opinionInvalid: false,
    modifiedBy: "farrier",
    pending: false,
    pendingShape: "",
    pendingIronType: "",
    pendingNailPositions: "",
    pendingPainScore: null,
    note: "",
  };
}

export function createRecordNo(seq: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `HOOF-${ymd}-${String(seq).padStart(4, "0")}`;
}

export function createBaselineNo(seq: number): string {
  return `JQ-${String(seq).padStart(4, "0")}`;
}

/** 该蹄位是否已被任一方填写（非空） */
function hoofFilled(h: HoofPositionState): boolean {
  return Boolean(h.shape || h.ironType || h.nailPositions || h.painScore !== null || h.note);
}

/** 该蹄位是否已处置（兽医签字确认疼痛评分 → 方案锁定） */
export function isHandled(h: HoofPositionState): boolean {
  return h.vetSigned && h.locked && !h.opinionInvalid;
}

/** 统计一条记录中已处置蹄位数 */
export function handledCount(record: HoofRecord): number {
  return HOOF_POSITIONS.filter((p) => isHandled(record.hooves[p])).length;
}

function cloneHoof(h: HoofPositionState): HoofPositionState {
  return { ...h };
}

/**
 * 合并同一记录号的蹄铁师本地版与兽医门诊版。
 * 规则：
 *  - 兽医已签字 → 保留兽医安全值（疼痛评分），蹄位锁定；蹄铁师的蹄形/蹄铁/钉位改动转待处理
 *  - 两边都改但兽医未签字 → 待处理，不锁定，不生成复查通知
 *  - 只有一边改 → 采用该边
 *  - 已处置且有复查日期 → 生成复查通知；未处置不生成
 */
export function mergeRecordPair(
  local: HoofRecord,
  remote: HoofRecord,
  reviewDate: string | undefined,
  now: number
): { record: HoofRecord; conflicts: ConflictInfo[]; notifications: ReviewNotification[] } {
  const conflicts: ConflictInfo[] = [];
  const notifications: ReviewNotification[] = [];
  const hooves = {} as Record<HoofPosition, HoofPositionState>;

  for (const pos of HOOF_POSITIONS) {
    const l = local.hooves[pos];
    const r = remote.hooves[pos];
    const lSigned = l.vetSigned;
    const rSigned = r.vetSigned;
    const vetSigned = lSigned || rSigned;
    const vetPain = r.painScore ?? l.painScore;

    if (vetSigned) {
      // 兽医签字 → 保留兽医安全值，蹄位锁定
      const vet = rSigned ? r : l;
      const other = rSigned ? l : r;
      // 待处理判定只比对蹄铁师可编辑字段（蹄形/蹄铁/钉位）；疼痛评分属兽医安全值，不参与
      const pending =
        other.shape !== vet.shape ||
        other.ironType !== vet.ironType ||
        other.nailPositions !== vet.nailPositions;
      const merged: HoofPositionState = {
        ...cloneHoof(vet),
        painScore: vet.painScore ?? vetPain,
        vetSigned: true,
        locked: true,
        safetyValue: true,
        opinionInvalid: false,
        modifiedBy: "vet",
        pending,
        pendingShape: other.shape,
        pendingIronType: other.ironType,
        pendingNailPositions: other.nailPositions,
        pendingPainScore: other.painScore,
      };
      hooves[pos] = merged;
      if (pending) {
        conflicts.push({
          recordNo: local.recordNo,
          horseId: local.horseId,
          position: pos,
          kept: "vet",
          reason: "两边修改同一蹄位，保留兽医安全值，蹄铁师版本待处理",
        });
      }
      // 已处置 → 生成复查通知
      if (reviewDate) {
        notifications.push({
          id: uid("NTF"),
          horseId: local.horseId,
          recordNo: local.recordNo,
          reviewDate,
          reason: "兽医已签字锁定蹄位，按计划复查",
          handled: true,
          invalid: false,
          createdAt: now,
        });
      }
    } else if (hoofFilled(l) && hoofFilled(r)) {
      // 两边都改但未签字 → 待处理，不锁定，不生成通知
      hooves[pos] = {
        ...cloneHoof(r),
        painScore: r.painScore ?? l.painScore,
        vetSigned: false,
        locked: false,
        safetyValue: false,
        opinionInvalid: false,
        modifiedBy: "vet",
        pending: true,
        pendingShape: l.shape,
        pendingIronType: l.ironType,
        pendingNailPositions: l.nailPositions,
        pendingPainScore: l.painScore,
      };
      conflicts.push({
        recordNo: local.recordNo,
        horseId: local.horseId,
        position: pos,
        kept: "vet",
        reason: "两边修改同一蹄位，兽医未签字，另一版待处理",
      });
    } else {
      // 只有一边改 → 采用该边
      const chosen = hoofFilled(r) ? r : l;
      hooves[pos] = { ...cloneHoof(chosen), pending: false };
    }
  }

  const hasConflict = conflicts.length > 0;
  const record: HoofRecord = {
    ...local,
    hooves,
    side: "merged",
    syncStatus: hasConflict ? "conflict" : "synced",
    confirmed: true,
    basedOnRecordNo: local.basedOnRecordNo || local.recordNo,
    mergeAttempts: local.mergeAttempts + 1,
    lastError: "",
    updatedAt: now,
  };

  return { record, conflicts, notifications };
}

/**
 * 兽医签字确认疼痛评分 → 蹄位方案锁定。
 * 若蹄位已锁定且未走签字流程，则按越权拒绝。
 */
export function signAndLockPosition(
  record: HoofRecord,
  pos: HoofPosition,
  painScore: number,
  now: number
): { record: HoofRecord; opinion: VetOpinion } {
  const prev = record.hooves[pos];
  const next: HoofPositionState = {
    ...cloneHoof(prev),
    painScore,
    vetSigned: true,
    locked: true,
    safetyValue: true,
    opinionInvalid: false,
    modifiedBy: "vet",
    pending: false,
    pendingShape: "",
    pendingIronType: "",
    pendingNailPositions: "",
    pendingPainScore: null,
  };
  const hooves = { ...record.hooves, [pos]: next };
  const opinion: VetOpinion = {
    id: uid("OPN"),
    recordNo: record.recordNo,
    horseId: record.horseId,
    position: pos,
    painScore,
    signed: true,
    invalid: false,
    createdAt: now,
  };
  return {
    record: { ...record, hooves, side: "vet", syncStatus: "synced", updatedAt: now },
    opinion,
  };
}

/**
 * 蹄铁师修改蹄位。若蹄位已锁定（兽医已签字），按越权拒绝。
 * 返回 { ok, record?, error? }
 */
export function farrierEditPosition(
  record: HoofRecord,
  pos: HoofPosition,
  patch: Partial<HoofPositionState>,
  now: number
): { ok: boolean; record?: HoofRecord; error?: string } {
  const prev = record.hooves[pos];
  if (prev.locked || prev.vetSigned) {
    return {
      ok: false,
      error: `越权拒绝：${pos} 蹄位已经兽医签字锁定，需兽医重新签字后方可调整`,
    };
  }
  const next: HoofPositionState = {
    ...cloneHoof(prev),
    ...patch,
    modifiedBy: "farrier",
  };
  const hooves = { ...record.hooves, [pos]: next };
  return {
    ok: true,
    record: { ...record, hooves, side: "farrier", syncStatus: "local", updatedAt: now },
  };
}

/**
 * 档案或复查日期变化 → 已签意见和通知立即失效重算：
 *  - 该马匹所有已签意见标记 invalid
 *  - 该马匹所有通知标记 invalid（清除，待重新处置后生成）
 *  - 蹄位锁定解除（意见失效，需兽医重签）
 */
export function invalidateForHorse(
  state: AppState,
  horseId: string,
  now: number
): Partial<AppState> {
  const opinions: Record<string, VetOpinion> = {};
  for (const [id, op] of Object.entries(state.opinions)) {
    opinions[id] = op.horseId === horseId ? { ...op, invalid: true } : op;
  }
  const notifications: Record<string, ReviewNotification> = {};
  for (const [id, n] of Object.entries(state.notifications)) {
    notifications[id] = n.horseId === horseId ? { ...n, invalid: true } : n;
  }
  const records: Record<string, HoofRecord> = {};
  for (const [id, rec] of Object.entries(state.records)) {
    if (rec.horseId !== horseId) {
      records[id] = rec;
      continue;
    }
    const hooves = { ...rec.hooves };
    for (const pos of HOOF_POSITIONS) {
      const h = hooves[pos];
      if (h.vetSigned || h.locked) {
        hooves[pos] = {
          ...cloneHoof(h),
          vetSigned: false,
          locked: false,
          safetyValue: false,
          opinionInvalid: true,
        };
      }
    }
    records[id] = { ...rec, hooves, syncStatus: "pending", updatedAt: now };
  }
  return { opinions, notifications, records };
}

/**
 * 合并失败后从最后确认记录按原号重试。
 *  - 以 basedOnRecordNo 对应的最后确认记录为底
 *  - 沿用原 recordNo，不新增记录号
 *  - 换蹄次数只统计 confirmed 记录，重试不重复计入
 */
export function retryMerge(
  state: AppState,
  recordNo: string,
  now: number
): { ok: boolean; record?: HoofRecord; error?: string } {
  const target = Object.values(state.records).find((r) => r.recordNo === recordNo);
  if (!target) return { ok: false, error: "未找到记录" };
  const baseNo = target.basedOnRecordNo || target.recordNo;
  const base = Object.values(state.records).find((r) => r.recordNo === baseNo) || target;
  // 以最后确认记录为底，沿用原记录号重试
  const retried: HoofRecord = {
    ...cloneRecord(base),
    recordNo: target.recordNo, // 原号
    basedOnRecordNo: base.basedOnRecordNo || base.recordNo,
    mergeAttempts: target.mergeAttempts + 1,
    syncStatus: "synced",
    lastError: "",
    confirmed: true,
    updatedAt: now,
  };
  return { ok: true, record: retried };
}

function cloneRecord(r: HoofRecord): HoofRecord {
  return { ...r, hooves: { ...r.hooves } };
}

function emptyHoovesRecord(): Record<HoofPosition, HoofPositionState> {
  return { LF: emptyHoof(), RF: emptyHoof(), LH: emptyHoof(), RH: emptyHoof() };
}

/** 蹄铁师可编辑字段（蹄形/蹄铁/钉位/备注） */
function farrierFieldsEqual(a: HoofPositionState, b: HoofPositionState): boolean {
  return (
    a.shape === b.shape &&
    a.ironType === b.ironType &&
    a.nailPositions === b.nailPositions &&
    a.note === b.note
  );
}

/** 兽医可编辑字段（疼痛评分/签字/锁定/安全值） */
function vetFieldsEqual(a: HoofPositionState, b: HoofPositionState): boolean {
  return (
    (a.painScore ?? null) === (b.painScore ?? null) &&
    a.vetSigned === b.vetSigned &&
    a.locked === b.locked &&
    a.safetyValue === b.safetyValue
  );
}

/**
 * 三路合并：base（最后同步状态）+ local（蹄铁师离线版）+ remote（兽医门诊版）。
 *  - 两边都没改 → 采用 base
 *  - 只有蹄铁师改 → 采用蹄铁师版
 *  - 只有兽医改 → 采用兽医版
 *  - 两边都改同一蹄位 → 保留兽医安全值，蹄铁师版待处理
 *  - 已处置且有复查日期 → 生成复查通知；未处置不生成
 */
export function mergeRecordPair3Way(
  base: HoofRecord | undefined,
  local: HoofRecord,
  remote: HoofRecord,
  reviewDate: string | undefined,
  now: number
): { record: HoofRecord; conflicts: ConflictInfo[]; notifications: ReviewNotification[] } {
  const baseHooves = base?.hooves ?? emptyHoovesRecord();
  const conflicts: ConflictInfo[] = [];
  const notifications: ReviewNotification[] = [];
  const hooves = {} as Record<HoofPosition, HoofPositionState>;

  for (const pos of HOOF_POSITIONS) {
    const b = baseHooves[pos];
    const l = local.hooves[pos];
    const r = remote.hooves[pos];
    const farrierChanged = !farrierFieldsEqual(l, b);
    const vetChanged = !vetFieldsEqual(r, b);

    let merged: HoofPositionState;
    let conflict = false;

    if (!farrierChanged && !vetChanged) {
      merged = cloneHoof(b);
    } else if (farrierChanged && !vetChanged) {
      merged = cloneHoof(l);
    } else if (!farrierChanged && vetChanged) {
      merged = cloneHoof(r);
    } else {
      // 两边都改 → 保留兽医安全值，蹄铁师版待处理
      merged = {
        ...cloneHoof(r),
        painScore: r.painScore ?? l.painScore,
        vetSigned: true,
        locked: true,
        safetyValue: true,
        opinionInvalid: false,
        modifiedBy: "vet",
        pending: true,
        pendingShape: l.shape,
        pendingIronType: l.ironType,
        pendingNailPositions: l.nailPositions,
        pendingPainScore: l.painScore,
      };
      conflict = true;
    }

    hooves[pos] = merged;
    if (conflict) {
      conflicts.push({
        recordNo: local.recordNo,
        horseId: local.horseId,
        position: pos,
        kept: "vet",
        reason: "两边修改同一蹄位，保留兽医安全值，蹄铁师版本待处理",
      });
    }
    if (isHandled(merged) && reviewDate) {
      notifications.push({
        id: uid("NTF"),
        horseId: local.horseId,
        recordNo: local.recordNo,
        reviewDate,
        reason: "兽医已签字锁定蹄位，按计划复查",
        handled: true,
        invalid: false,
        createdAt: now,
      });
    }
  }

  const hasConflict = conflicts.length > 0;
  const record: HoofRecord = {
    ...local,
    hooves,
    side: "merged",
    syncStatus: hasConflict ? "conflict" : "synced",
    confirmed: true,
    basedOnRecordNo: local.basedOnRecordNo || local.recordNo,
    baseHooves: hooves, // 更新最后同步状态
    mergeAttempts: local.mergeAttempts + 1,
    lastError: "",
    updatedAt: now,
  };

  return { record, conflicts, notifications };
}

/** 旧档案缺基准号先补齐：为 baselineMissing 的马匹生成基准号 */
export function supplementBaselines(state: AppState, now: number): Partial<AppState> {
  const horses: Record<string, Horse> = {};
  let seq = state.seq.baseline;
  for (const [id, h] of Object.entries(state.horses)) {
    if (h.baselineMissing || !h.baselineNo) {
      seq += 1;
      horses[id] = {
        ...h,
        baselineNo: createBaselineNo(seq),
        baselineMissing: false,
        updatedAt: now,
      };
    } else {
      horses[id] = h;
    }
  }
  return { horses, seq: { ...state.seq, baseline: seq } };
}

/** 换蹄次数：只统计已确认（confirmed）的蹄铁记录，重试不重复计入 */
export function hoofChangeCount(state: AppState, horseId: string): number {
  return Object.values(state.records).filter((r) => r.horseId === horseId && r.confirmed).length;
}

/** 按记录号查找记录 */
export function findByRecordNo(state: AppState, recordNo: string): HoofRecord | undefined {
  return Object.values(state.records).find((r) => r.recordNo === recordNo);
}
