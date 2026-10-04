// 演示数据：预置「场边离线队列 + 诊室中心库」的协作场景
import { DB, HoofEntry, HoofPos, ShoeRecord, VetOpinion } from "./types";

const hoof = (
  shape: string,
  shoeType: string,
  nails: string,
  painScore: number,
  gaitIssue: string,
  abnormal = false
): HoofEntry => ({ shape, shoeType, nails, painScore, gaitIssue, abnormal });

const normal = () => hoof("蹄形正常", "普通铁", "6钉标准", 0, "步态正常", false);

function makeRecord(
  recordNo: string,
  horseId: string,
  farrier: string,
  date: string,
  nextCheckDate: string,
  hooves: Record<HoofPos, HoofEntry>,
  note: string,
  version = 1,
  origin: "field" | "clinic" = "clinic"
): ShoeRecord {
  return {
    recordNo,
    horseId,
    farrier,
    date,
    nextCheckDate,
    plan: { hooves, locked: false },
    note,
    origin,
    version,
    confirmedAt: "2026/10/02 09:00:00",
  };
}

export function seedDB(): DB {
  // R-2026-0001：诊室已把右前蹄调为「铝蹄铁加宽 / 疼痛3分」（v2）
  const r0001 = makeRecord(
    "R-2026-0001",
    "HORSE-18",
    "赵铁柱",
    "2026-10-01",
    "2026-10-18",
    {
      LF: normal(),
      RF: hoof("外侧磨耗", "铝蹄铁加宽", "6钉外侧错位", 3, "右前蹄外侧磨耗", true),
      LH: normal(),
      RH: normal(),
    },
    "右前蹄拍照归档，诊室已调整",
    2
  );

  // 蹄铁师离线时看到的是 v1 快照，并离线修改了右前蹄 → 回网合并必冲突
  const r0001base: Record<HoofPos, HoofEntry> = {
    LF: normal(),
    RF: hoof("外侧磨耗", "普通铁", "6钉标准", 2, "右前蹄外侧磨耗", true),
    LH: normal(),
    RH: normal(),
  };

  // R-2026-0002：兽医已签字锁定（用于演示越权拒绝）
  const r0002 = makeRecord(
    "R-2026-0002",
    "HORSE-27",
    "赵铁柱",
    "2026-09-28",
    "2026-10-11",
    {
      LF: normal(),
      RF: normal(),
      LH: hoof("蹄壁裂纹", "加护蹄垫", "4钉避裂", 2, "后蹄裂纹", true),
      RH: normal(),
    },
    "左后蹄裂纹避钉，拍照归档"
  );
  r0002.plan.locked = true;
  r0002.plan.lockedBy = "林岚";
  r0002.plan.lockedAt = "2026/10/02 10:30:00";

  const opinion0002: VetOpinion = {
    id: "op-0002",
    recordNo: "R-2026-0002",
    horseId: "HORSE-27",
    vet: "林岚",
    signature: "VET-LIN-0002",
    painScores: { LF: 0, RF: 0, LH: 2, RH: 0 },
    comment: "裂纹避钉方案确认，两周后复查",
    signedAt: "2026/10/02 10:30:00",
    profileVersion: 1,
    nextCheckDate: "2026-10-11",
    valid: true,
  };

  // HORSE-07 老骥：旧档案缺基准号，历史修蹄仍可查
  const h0090 = makeRecord(
    "R-2025-0090",
    "HORSE-07",
    "孙老师傅",
    "2025-08-12",
    "2025-09-12",
    { LF: normal(), RF: normal(), LH: normal(), RH: normal() },
    "常规修蹄"
  );
  const h0091 = makeRecord(
    "R-2025-0091",
    "HORSE-07",
    "孙老师傅",
    "2025-09-12",
    "2025-10-12",
    {
      LF: hoof("蹄跟偏低", "普通铁", "6钉标准", 1, "步态正常"),
      RF: normal(),
      LH: hoof("蹄跟偏低", "垫跟铁", "6钉标准", 1, "步态正常"),
      RH: normal(),
    },
    "后蹄换垫跟铁"
  );

  // 场边离线队列：① 对 R-2026-0001 的离线修改（将与诊室冲突）② 给缺基准号的老骥新建记录（合并将失败）
  const r0003 = makeRecord(
    "R-2026-0003",
    "HORSE-07",
    "赵铁柱",
    "2026-10-03",
    "2026-10-25",
    {
      LF: normal(),
      RF: normal(),
      LH: hoof("蹄跟偏低", "垫跟铁", "6钉标准", 1, "步态正常"),
      RH: hoof("蹄跟偏低", "垫跟铁", "6钉标准", 1, "步态正常"),
    },
    "场边断网登记，待回网合并",
    1,
    "field"
  );
  r0003.confirmedAt = "";

  return {
    connectivity: "offline",
    seq: 3,
    horses: [
      { id: "HORSE-18", name: "疾风", category: "运动马", breed: "温血马", age: 9, baselineNo: "BASE-018-01", profileVersion: 1, updatedAt: "2026/10/01 08:00:00" },
      { id: "HORSE-27", name: "乌云", category: "运动马", breed: "纯血马", age: 7, baselineNo: "BASE-027-01", profileVersion: 1, updatedAt: "2026/09/28 08:00:00" },
      { id: "HORSE-31", name: "白蹄", category: "休养马", breed: "蒙古马", age: 12, baselineNo: "BASE-031-01", profileVersion: 1, updatedAt: "2026/09/20 08:00:00" },
      { id: "HORSE-07", name: "老骥", category: "休养马", breed: "伊犁马", age: 18, profileVersion: 1, updatedAt: "2025/09/12 08:00:00" },
    ],
    records: [r0001, r0002, h0090, h0091],
    outbox: [
      {
        id: "ob-1",
        kind: "update",
        recordNo: "R-2026-0001",
        horseId: "HORSE-18",
        baseVersion: 1,
        baseHooves: r0001base,
        changes: { RF: hoof("外侧磨耗加重", "铝蹄铁加宽+护垫", "8钉加固", 4, "右前蹄外侧磨耗", true) },
        createdAt: "2026/10/03 16:20:00",
        status: "queued",
      },
      {
        id: "ob-2",
        kind: "create",
        recordNo: "R-2026-0003",
        horseId: "HORSE-07",
        baseVersion: 0,
        record: r0003,
        createdAt: "2026/10/03 17:05:00",
        status: "queued",
      },
    ],
    opinions: [opinion0002],
    conflicts: [],
    notices: [
      { id: "nt-1", horseId: "HORSE-18", recordNo: "R-2026-0001", dueDate: "2026-10-18", createdAt: "2026/10/02 09:00:00", valid: true },
      { id: "nt-2", horseId: "HORSE-27", recordNo: "R-2026-0002", dueDate: "2026-10-11", createdAt: "2026/10/02 10:30:00", valid: true },
    ],
    shoeLedger: {
      "HORSE-18": { counted: ["R-2026-0001"], changes: 1 },
      "HORSE-27": { counted: ["R-2026-0002"], changes: 1 },
      "HORSE-07": { counted: ["R-2025-0090", "R-2025-0091"], changes: 2 },
    },
    lastConfirmedNo: "R-2026-0002",
    log: [
      "[2026/10/03 17:05:00] 场边离线登记 R-2026-0003（老骥），已入待同步队列",
      "[2026/10/03 16:20:00] 场边离线修改 R-2026-0001 右前蹄，已入待同步队列（基准版本 v1）",
      "[2026/10/02 10:30:00] 兽医 林岚 签字确认 R-2026-0002 四蹄疼痛评分，蹄位方案锁定",
    ],
  };
}
