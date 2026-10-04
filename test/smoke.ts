// 冒烟测试：离线协作核心业务规则
import { seedDB } from "../src/seed";
import {
  backfillBaseline,
  clinicUpdateHoof,
  queueFarrierUpdate,
  retryMerge,
  setConnectivity,
  signRecord,
  syncMerge,
  updateHorseProfile,
  updateNextCheckDate,
  findRecord,
  validOpinionOf,
} from "../src/store";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name); }
}

const db = seedDB();

// 1. 断网时不能合并
console.log("1. 断网拦截");
check("断网时合并被拒绝", syncMerge(db).ok === false);

// 2. 回网合并：R-2026-0001 冲突保留兽医安全值；R-2026-0003 缺基准号失败
console.log("2. 回网合并");
setConnectivity(db, "online");
const r1 = syncMerge(db);
check("合并因缺基准号失败", r1.ok === false);
const rf = findRecord(db, "R-2026-0001")!.plan.hooves.RF;
check("冲突蹄位保留兽医安全值(疼痛3分)", rf.painScore === 3 && rf.shoeType === "铝蹄铁加宽");
check("场边版本转待处理", db.conflicts.length === 1 && db.conflicts[0].status === "open" && db.conflicts[0].rival.painScore === 4);
check("R-2026-0003 标记失败(缺基准号)", db.outbox.some((e) => e.recordNo === "R-2026-0003" && e.status === "failed"));
check("最后确认记录为 R-2026-0001", db.lastConfirmedNo === "R-2026-0001");

// 3. 未处置冲突不生成复查通知
console.log("3. 冲突阻断通知");
check("HORSE-18 无有效复查通知", !db.notices.some((n) => n.horseId === "HORSE-18" && n.valid));

// 4. 补齐基准号 → 按原号重试 → 成功且换蹄不重复计入
console.log("4. 补齐基准号后重试");
backfillBaseline(db, "HORSE-07");
check("基准号已补齐", !!db.horses.find((h) => h.id === "HORSE-07")!.baselineNo);
const before = db.shoeLedger["HORSE-07"].changes;
const r2 = retryMerge(db);
check("重试合并成功", r2.ok === true);
check("R-2026-0003 按原号入库", !!findRecord(db, "R-2026-0003"));
check("换蹄只计入一次", db.shoeLedger["HORSE-07"].changes === before + 1);
const r3 = retryMerge(db);
check("再次重试幂等(队列已空)", r3.ok === false && db.shoeLedger["HORSE-07"].changes === before + 1);
check("历史修蹄仍可查", db.records.filter((r) => r.horseId === "HORSE-07").length === 3);

// 5. 处置冲突：采纳场边版但保留兽医安全值 → 重新生成通知
console.log("5. 冲突处置");
const { resolveConflict } = require("../src/store");
resolveConflict(db, db.conflicts[0].id, "apply-rival");
const rf2 = findRecord(db, "R-2026-0001")!.plan.hooves.RF;
check("采纳场边蹄铁但保留兽医疼痛评分", rf2.shoeType === "铝蹄铁加宽+护垫" && rf2.painScore === 3);
check("冲突处置后生成复查通知", db.notices.some((n) => n.horseId === "HORSE-18" && n.valid));

// 6. 越权：锁定蹄位无签字/错签字拒绝，正确签字放行
console.log("6. 越权拒绝");
check("场边改锁定蹄位被拒", queueFarrierUpdate(db, "R-2026-0002", "LH", findRecord(db, "R-2026-0002")!.plan.hooves.LH).ok === false);
check("无签字诊室改锁定蹄位被拒", clinicUpdateHoof(db, "R-2026-0002", "LH", { painScore: 5 }, "").ok === false);
check("错签字被拒", clinicUpdateHoof(db, "R-2026-0002", "LH", { painScore: 5 }, "WRONG").ok === false);
check("正确签字放行", clinicUpdateHoof(db, "R-2026-0002", "LH", { painScore: 2 }, "VET-LIN-0002").ok === true);

// 7. 签字锁定 → 档案变更使签字失效并解锁 → 复查日期变更同样失效
console.log("7. 签字锁定与失效重算");
check("R-2026-0001 签字锁定", signRecord(db, "R-2026-0001", "林岚", "VET-LIN-0001", "确认").ok === true);
check("方案已锁定", findRecord(db, "R-2026-0001")!.plan.locked === true);
updateHorseProfile(db, "HORSE-18", { breed: "汉诺威马" });
check("档案变更后签字失效", validOpinionOf(db, "R-2026-0001") === undefined);
check("签字失效后方案解锁", findRecord(db, "R-2026-0001")!.plan.locked === false);
check("档案变更后通知重算仍有效", db.notices.some((n) => n.horseId === "HORSE-18" && n.valid));
signRecord(db, "R-2026-0001", "林岚", "VET-LIN-0001", "重新确认");
updateNextCheckDate(db, "R-2026-0001", "2026-11-05");
check("复查日期变更后签字再次失效", validOpinionOf(db, "R-2026-0001") === undefined);
check("复查日期变更后通知按新日期重算", db.notices.some((n) => n.horseId === "HORSE-18" && n.valid && n.dueDate === "2026-11-05"));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
