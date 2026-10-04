// 领域模型：马匹档案 / 蹄铁记录 / 复查计划 / 兽医意见 / 离线合并

export type HoofPos = "LF" | "RF" | "LH" | "RH";

export const HOOF_ORDER: HoofPos[] = ["LF", "RF", "LH", "RH"];

export const HOOF_LABEL: Record<HoofPos, string> = {
  LF: "左前蹄",
  RF: "右前蹄",
  LH: "左后蹄",
  RH: "右后蹄",
};

/** 单个蹄位方案：蹄形、蹄铁、钉位、疼痛评分、步态 */
export interface HoofEntry {
  shape: string; // 蹄形评估
  shoeType: string; // 蹄铁类型
  nails: string; // 钉位
  painScore: number; // 疼痛评分 0-5（兽医安全值）
  gaitIssue: string; // 步态问题
  abnormal: boolean; // 异常步态标记
}

/** 一次修蹄的四蹄方案；兽医签字后锁定 */
export interface HoofPlan {
  hooves: Record<HoofPos, HoofEntry>;
  locked: boolean;
  lockedBy?: string;
  lockedAt?: string;
}

/** 蹄铁记录（中心库已确认版本） */
export interface ShoeRecord {
  recordNo: string; // 记录号，合并与重试的主键
  horseId: string;
  farrier: string; // 蹄铁师
  date: string; // 修蹄日期
  nextCheckDate: string; // 下次复查日期
  plan: HoofPlan;
  note: string; // 照片备注
  origin: "field" | "clinic"; // 场边 / 诊室
  version: number;
  confirmedAt: string;
}

/** 兽医意见：签字确认疼痛评分；档案或复查日期变化后失效 */
export interface VetOpinion {
  id: string;
  recordNo: string;
  horseId: string;
  vet: string;
  signature: string; // 签字口令，后续改锁定蹄位需出示
  painScores: Record<HoofPos, number>; // 签字确认的疼痛评分（安全值）
  comment: string;
  signedAt: string;
  profileVersion: number; // 签字时的档案版本
  nextCheckDate: string; // 签字时的复查日期
  valid: boolean;
  invalidReason?: string;
}

/** 马匹档案；旧档案可能缺基准号 */
export interface Horse {
  id: string;
  name: string;
  category: "运动马" | "休养马";
  breed: string;
  age: number;
  baselineNo?: string; // 基准号：合并/新建记录的前置条件
  profileVersion: number; // 档案变更即 +1，使已签意见失效
  updatedAt: string;
}

/** 场边离线队列条目 */
export interface OutboxEntry {
  id: string;
  kind: "create" | "update";
  recordNo: string;
  horseId: string;
  baseVersion: number; // 蹄铁师离线时看到的中心库版本
  baseHooves?: Record<HoofPos, HoofEntry>; // 离线时的四蹄快照（冲突检测基准）
  changes?: Partial<Record<HoofPos, HoofEntry>>;
  record?: ShoeRecord; // kind=create 时的完整记录
  createdAt: string;
  status: "queued" | "failed";
  failReason?: string;
}

/** 合并冲突：同一蹄位两边都改 → 保留兽医安全值，另一版待处理 */
export interface PendingConflict {
  id: string;
  recordNo: string;
  horseId: string;
  hoof: HoofPos;
  kept: HoofEntry; // 保留的诊室版本（含兽医安全值）
  rival: HoofEntry; // 待处理的场边版本
  createdAt: string;
  status: "open" | "resolved";
  resolution?: string;
}

/** 复查通知；存在未处置冲突时不生成，档案/日期变化后失效重算 */
export interface RecheckNotice {
  id: string;
  horseId: string;
  recordNo: string;
  dueDate: string;
  createdAt: string;
  valid: boolean;
  invalidReason?: string;
}

/** 换蹄计数次要账本：按记录号幂等计入，重试不重复计数 */
export interface ShoeLedger {
  counted: string[]; // 已计入的记录号
  changes: number;
}

export interface DB {
  connectivity: "online" | "offline";
  seq: number; // 记录号序列
  horses: Horse[];
  records: ShoeRecord[]; // 中心库（诊室侧）
  outbox: OutboxEntry[]; // 场边离线队列
  opinions: VetOpinion[];
  conflicts: PendingConflict[];
  notices: RecheckNotice[];
  shoeLedger: Record<string, ShoeLedger>;
  lastConfirmedNo?: string; // 最后确认记录号（合并失败后的重试起点）
  log: string[];
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
