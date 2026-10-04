// 合并引擎逻辑验证脚本
import {
  mergeRecordPair,
  mergeRecordPair3Way,
  signAndLockPosition,
  farrierEditPosition,
  invalidateForHorse,
  retryMerge,
  supplementBaselines,
  hoofChangeCount,
  emptyHoof,
  createRecordNo,
} from "../src/domain/engine";
import { AppState, HoofRecord, HoofPosition } from "../src/domain/types";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ✓", msg);
  } else {
    fail++;
    console.log("  ✗ FAIL:", msg);
  }
}

let idCounter = 0;
function makeRecord(no: string, horseId: string): HoofRecord {
  idCounter += 1;
  return {
    id: "R-" + no + "-" + idCounter,
    recordNo: no,
    horseId,
    date: "2026-10-04",
    hooves: { LF: emptyHoof(), RF: emptyHoof(), LH: emptyHoof(), RH: emptyHoof() },
    side: "farrier",
    syncStatus: "local",
    basedOnRecordNo: no,
    confirmed: false,
    mergeAttempts: 0,
    lastError: "",
    createdAt: 1,
    updatedAt: 1,
  };
}

console.log("\n=== 场景1：兽医签字后合并 → 蹄位锁定 + 生成复查通知 ===");
{
  const local = makeRecord("HOOF-001", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-001", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3", painScore: 2, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const { record, notifications } = mergeRecordPair(local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.locked === true, "蹄位已锁定");
  assert(record.hooves.LF.vetSigned === true, "兽医已签字");
  assert(record.hooves.LF.painScore === 2, "保留兽医安全值（疼痛评分2）");
  assert(notifications.length === 1, "生成1条复查通知");
  assert(record.syncStatus === "synced", "同步状态为已同步");
}

console.log("\n=== 场景2：两边改同一蹄位，兽医未签字 → 待处理，不生成通知 ===");
{
  const local = makeRecord("HOOF-002", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "外侧磨耗", ironType: "铝蹄铁", nailPositions: "1,2", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-002", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "裂纹", ironType: "加护蹄垫", nailPositions: "1,2,3", modifiedBy: "vet" };
  const { record, conflicts, notifications } = mergeRecordPair(local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.pending === true, "蹄位标记待处理");
  assert(record.hooves.LF.locked === false, "未锁定");
  assert(conflicts.length === 1, "产生1个冲突");
  assert(notifications.length === 0, "未处置不生成复查通知");
  assert(record.syncStatus === "conflict", "同步状态为冲突");
}

console.log("\n=== 场景3：两边改同一蹄位，兽医已签字 → 保留兽医安全值，蹄铁师版待处理 ===");
{
  const local = makeRecord("HOOF-003", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "外侧磨耗", ironType: "铝蹄铁", nailPositions: "1,2", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-003", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "裂纹", ironType: "加护蹄垫", nailPositions: "1,2,3", painScore: 5, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const { record, conflicts } = mergeRecordPair(local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.painScore === 5, "保留兽医疼痛评分5");
  assert(record.hooves.LF.locked === true, "蹄位锁定");
  assert(record.hooves.LF.pending === true, "蹄铁师版本待处理");
  assert(record.hooves.LF.pendingShape === "外侧磨耗", "待处理版保留蹄铁师蹄形");
  assert(conflicts.length === 1, "产生1个冲突");
}

console.log("\n=== 场景4：蹄铁师绕过签名改锁定蹄位 → 越权拒绝 ===");
{
  const rec = makeRecord("HOOF-004", "H1");
  rec.hooves.LF = { ...emptyHoof(), painScore: 3, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const res = farrierEditPosition(rec, "LF", { shape: "强行修改" }, 100);
  assert(res.ok === false, "修改被拒绝");
  assert(res.error?.includes("越权"), "返回越权错误");
  assert(rec.hooves.LF.shape === "", "原蹄位未被改动");
}

console.log("\n=== 场景5：合并失败后从最后确认记录按原号重试，不重复计入换蹄次数 ===");
{
  const state: AppState = {
    horses: {},
    records: {},
    plans: {},
    opinions: {},
    notifications: {},
    conflicts: [],
    mergeLog: [],
    online: true,
    seq: { record: 5, baseline: 1, plan: 0, opinion: 0, notification: 0 },
  };
  const base = makeRecord("HOOF-005", "H1");
  base.confirmed = true;
  base.side = "merged";
  base.syncStatus = "synced";
  base.hooves.LF = { ...emptyHoof(), shape: "正常", painScore: 2, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const failed = makeRecord("HOOF-005", "H1");
  failed.confirmed = true;
  failed.syncStatus = "failed";
  failed.mergeAttempts = 1;
  failed.basedOnRecordNo = "HOOF-005";
  state.records[base.id] = base;
  state.records[failed.id] = failed;
  const before = hoofChangeCount(state, "H1");
  assert(before === 2, "重试前换蹄次数为2（两条confirmed）");
  const r = retryMerge(state, "HOOF-005", 200);
  assert(r.ok === true, "重试成功");
  assert(r.record?.recordNo === "HOOF-005", "沿用原记录号");
  assert(r.record?.syncStatus === "synced", "重试后已同步");
  // 重试不新增记录，换蹄次数不变
  const after = hoofChangeCount(state, "H1");
  assert(after === 2, "重试后换蹄次数仍为2，不重复计入");
}

console.log("\n=== 场景6：旧档案缺基准号 → 先补齐，历史修蹄仍可查 ===");
{
  const state: AppState = {
    horses: {
      H1: {
        id: "H1", baselineNo: "", baselineMissing: true, name: "HORSE-31", breed: "本地马",
        status: "运动马", gaitIssue: "步态不稳", abnormalGait: true, note: "旧档案",
        createdAt: 1, updatedAt: 1,
      },
    },
    records: { R1: makeRecord("HOOF-006", "H1") },
    plans: {},
    opinions: {},
    notifications: {},
    conflicts: [],
    mergeLog: [],
    online: true,
    seq: { record: 6, baseline: 2, plan: 0, opinion: 0, notification: 0 },
  };
  const inv = supplementBaselines(state, 100);
  const h = inv.horses!["H1"];
  assert(h.baselineMissing === false, "基准号已补齐");
  assert(h.baselineNo === "JQ-0003", "生成基准号 JQ-0003");
  assert(state.records["R1"].recordNo === "HOOF-006", "历史修蹄记录仍可查");
}

console.log("\n=== 场景7：档案变化 → 已签意见和通知立即失效重算 ===");
{
  const state: AppState = {
    horses: {
      H1: {
        id: "H1", baselineNo: "JQ-0001", baselineMissing: false, name: "HORSE-18", breed: "温血马",
        status: "运动马", gaitIssue: "右前蹄磨耗", abnormalGait: true, note: "",
        createdAt: 1, updatedAt: 1,
      },
    },
    records: { R1: (() => { const r = makeRecord("HOOF-007", "H1"); r.hooves.LF = { ...emptyHoof(), painScore: 3, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" }; return r; })() },
    plans: { P1: { id: "P1", horseId: "H1", recordNo: "HOOF-007", reviewDate: "2026-10-20", reason: "复查", invalid: false, createdAt: 1, updatedAt: 1 } },
    opinions: { O1: { id: "O1", recordNo: "HOOF-007", horseId: "H1", position: "LF" as HoofPosition, painScore: 3, signed: true, invalid: false, createdAt: 1 } },
    notifications: { N1: { id: "N1", horseId: "H1", recordNo: "HOOF-007", reviewDate: "2026-10-20", reason: "复查", handled: true, invalid: false, createdAt: 1 } },
    conflicts: [],
    mergeLog: [],
    online: true,
    seq: { record: 7, baseline: 1, plan: 1, opinion: 1, notification: 1 },
  };
  const inv = invalidateForHorse(state, "H1", 100);
  assert(inv.opinions!["O1"].invalid === true, "已签意见失效");
  assert(inv.notifications!["N1"].invalid === true, "通知失效");
  assert(inv.records!["R1"].hooves.LF.locked === false, "蹄位锁定解除");
  assert(inv.records!["R1"].hooves.LF.opinionInvalid === true, "蹄位标记意见失效待重算");
}

console.log("\n=== 场景8：只有一边改 → 采用该边，不冲突 ===");
{
  const local = makeRecord("HOOF-008", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-008", "H1"); // 兽医未改
  const { record, conflicts } = mergeRecordPair(local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.shape === "正常", "采用蹄铁师蹄形");
  assert(record.hooves.LF.pending === false, "无待处理");
  assert(conflicts.length === 0, "无冲突");
}

console.log("\n=== 场景9（三路合并）：两边都改同一蹄位 → 保留兽医安全值，蹄铁师版待处理 ===");
{
  const base = makeRecord("HOOF-009", "H1");
  base.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3" };
  const local = makeRecord("HOOF-009", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "外侧磨耗", ironType: "铝蹄铁", nailPositions: "1,2", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-009", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3", painScore: 5, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const { record, conflicts } = mergeRecordPair3Way(base, local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.painScore === 5, "保留兽医疼痛评分5");
  assert(record.hooves.LF.locked === true, "蹄位锁定");
  assert(record.hooves.LF.pending === true, "蹄铁师版本待处理");
  assert(record.hooves.LF.pendingShape === "外侧磨耗", "待处理版保留蹄铁师蹄形");
  assert(conflicts.length === 1, "产生1个冲突");
}

console.log("\n=== 场景10（三路合并）：只有蹄铁师改 → 采用蹄铁师版，不冲突 ===");
{
  const base = makeRecord("HOOF-010", "H1");
  base.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3" };
  const local = makeRecord("HOOF-010", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "外侧磨耗", ironType: "铝蹄铁", nailPositions: "1,2", modifiedBy: "farrier" };
  const remote = makeRecord("HOOF-010", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3" }; // 兽医未改
  const { record, conflicts } = mergeRecordPair3Way(base, local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.shape === "外侧磨耗", "采用蹄铁师蹄形");
  assert(record.hooves.LF.pending === false, "无待处理");
  assert(conflicts.length === 0, "无冲突");
}

console.log("\n=== 场景11（三路合并）：只有兽医改 → 采用兽医版，不冲突 ===");
{
  const base = makeRecord("HOOF-011", "H1");
  base.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3" };
  const local = makeRecord("HOOF-011", "H1");
  local.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3" }; // 蹄铁师未改
  const remote = makeRecord("HOOF-011", "H1");
  remote.hooves.LF = { ...emptyHoof(), shape: "正常", ironType: "铝蹄铁", nailPositions: "1,2,3", painScore: 4, vetSigned: true, locked: true, safetyValue: true, modifiedBy: "vet" };
  const { record, conflicts } = mergeRecordPair3Way(base, local, remote, "2026-10-20", 100);
  assert(record.hooves.LF.painScore === 4, "采用兽医疼痛评分4");
  assert(record.hooves.LF.locked === true, "蹄位锁定");
  assert(record.hooves.LF.pending === false, "无待处理");
  assert(conflicts.length === 0, "无冲突");
}

console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
