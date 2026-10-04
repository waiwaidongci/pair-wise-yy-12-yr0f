// 种子数据：含缺基准号的旧档案、历史修蹄记录
import { AppState, HoofRecord, Horse, ReviewPlan } from "./types";
import { createBaselineNo, createRecordNo, emptyHoof, uid } from "./engine";

const now = Date.now();

function makeHorse(partial: Partial<Horse> & { name: string }): Horse {
  return {
    id: uid("H"),
    baselineNo: "",
    baselineMissing: false,
    breed: "",
    status: "运动马",
    gaitIssue: "",
    abnormalGait: false,
    note: "",
    createdAt: now - 86400000 * 30,
    updatedAt: now - 86400000 * 30,
    ...partial,
  };
}

function makeRecord(partial: Partial<HoofRecord> & { horseId: string; recordNo: string }): HoofRecord {
  const hooves = {
    LF: emptyHoof(),
    RF: emptyHoof(),
    LH: emptyHoof(),
    RH: emptyHoof(),
  };
  return {
    id: uid("R"),
    recordNo: "",
    horseId: "",
    date: new Date(now).toISOString().slice(0, 10),
    hooves,
    side: "farrier",
    syncStatus: "local",
    basedOnRecordNo: "",
    confirmed: false,
    mergeAttempts: 0,
    lastError: "",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function buildSeedState(): AppState {
  // 马匹：HORSE-18 / HORSE-27 / HORSE-31，其中 HORSE-31 为旧档案缺基准号
  const horses: Record<string, Horse> = {};
  const h1 = makeHorse({
    name: "HORSE-18",
    baselineNo: createBaselineNo(1),
    breed: "温血马",
    status: "运动马",
    gaitIssue: "右前蹄外侧磨耗",
    abnormalGait: true,
    note: "右前蹄受力不均，需关注",
  });
  const h2 = makeHorse({
    name: "HORSE-27",
    baselineNo: createBaselineNo(2),
    breed: "纯血马",
    status: "休养马",
    gaitIssue: "后蹄裂纹",
    abnormalGait: false,
    note: "后蹄加护蹄垫",
  });
  const h3 = makeHorse({
    name: "HORSE-31",
    baselineNo: "",
    baselineMissing: true, // 旧档案缺基准号
    breed: "本地马",
    status: "运动马",
    gaitIssue: "步态轻微不稳",
    abnormalGait: true,
    note: "旧档案，基准号待补齐",
  });
  horses[h1.id] = h1;
  horses[h2.id] = h2;
  horses[h3.id] = h3;

  // 历史修蹄记录（已确认，计入换蹄次数）
  const records: Record<string, HoofRecord> = {};
  const r1 = makeRecord({
    horseId: h1.id,
    recordNo: createRecordNo(1),
    date: new Date(now - 86400000 * 20).toISOString().slice(0, 10),
    side: "merged",
    syncStatus: "synced",
    confirmed: true,
    basedOnRecordNo: createRecordNo(1),
  });
  r1.hooves.RF = {
    ...emptyHoof(),
    shape: "外侧磨耗",
    ironType: "铝蹄铁",
    nailPositions: "1,2,3",
    painScore: 3,
    vetSigned: true,
    locked: true,
    safetyValue: true,
    modifiedBy: "vet",
  };
  records[r1.id] = r1;

  const r2 = makeRecord({
    horseId: h2.id,
    recordNo: createRecordNo(2),
    date: new Date(now - 86400000 * 10).toISOString().slice(0, 10),
    side: "merged",
    syncStatus: "synced",
    confirmed: true,
    basedOnRecordNo: createRecordNo(2),
  });
  r2.hooves.LH = {
    ...emptyHoof(),
    shape: "裂纹",
    ironType: "加护蹄垫",
    nailPositions: "1,2",
    painScore: 4,
    vetSigned: true,
    locked: true,
    safetyValue: true,
    modifiedBy: "vet",
  };
  r2.hooves.RH = {
    ...emptyHoof(),
    shape: "正常",
    ironType: "加护蹄垫",
    nailPositions: "1,2",
    modifiedBy: "farrier",
  };
  records[r2.id] = r2;

  // 复查计划
  const plans: Record<string, ReviewPlan> = {};
  const p1: ReviewPlan = {
    id: uid("P"),
    horseId: h1.id,
    recordNo: r1.recordNo,
    reviewDate: new Date(now + 86400000 * 14).toISOString().slice(0, 10),
    reason: "右前蹄外侧磨耗复查",
    invalid: false,
    createdAt: now,
    updatedAt: now,
  };
  plans[p1.id] = p1;

  return {
    horses,
    records,
    localRecords: {},
    plans,
    opinions: {},
    notifications: {},
    conflicts: [],
    mergeLog: [],
    online: true,
    seq: { record: 2, baseline: 2, plan: 1, opinion: 0, notification: 0 },
  };
}
