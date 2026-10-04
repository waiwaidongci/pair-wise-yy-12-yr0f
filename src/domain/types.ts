// 马术俱乐部蹄铁修整档案 —— 领域模型

export type HoofPosition = "LF" | "RF" | "LH" | "RH"; // 左前 右前 左后 右后
export const HOOF_POSITIONS: HoofPosition[] = ["LF", "RF", "LH", "RH"];
export const HOOF_LABELS: Record<HoofPosition, string> = {
  LF: "左前蹄",
  RF: "右前蹄",
  LH: "左后蹄",
  RH: "右后蹄",
};
export const HOOF_ORDER: Record<HoofPosition, number> = { LF: 0, RF: 1, LH: 2, RH: 3 };

export type HorseStatus = "运动马" | "休养马";
export type Side = "farrier" | "vet" | "merged";
export type SyncStatus = "local" | "synced" | "pending" | "conflict" | "failed";

/** 马匹档案 */
export interface Horse {
  id: string;
  baselineNo: string; // 基准号（旧档案可能缺失，需先补齐）
  baselineMissing: boolean; // 旧档案缺基准号标记
  name: string;
  breed: string;
  status: HorseStatus;
  gaitIssue: string; // 步态问题
  abnormalGait: boolean; // 异常步态标记
  note: string;
  createdAt: number;
  updatedAt: number; // 档案变化时间 → 触发意见/通知失效重算
}

/** 单个蹄位状态 */
export interface HoofPositionState {
  shape: string; // 蹄形
  ironType: string; // 蹄铁类型
  nailPositions: string; // 钉位
  painScore: number | null; // 疼痛评分（兽医安全值）
  vetSigned: boolean; // 兽医签字
  locked: boolean; // 蹄位方案锁定
  safetyValue: boolean; // 兽医安全值（冲突时保留）
  opinionInvalid: boolean; // 已签意见失效（需重算）
  modifiedBy: Side; // 最后修改方
  pending: boolean; // 另一版待处理
  pendingShape: string;
  pendingIronType: string;
  pendingNailPositions: string;
  pendingPainScore: number | null;
  note: string;
}

/** 蹄铁记录（按记录号合并） */
export interface HoofRecord {
  id: string;
  recordNo: string; // 记录号（合并键）
  horseId: string;
  date: string; // 修蹄日期
  hooves: Record<HoofPosition, HoofPositionState>;
  side: Side;
  syncStatus: SyncStatus;
  basedOnRecordNo: string; // 最后确认记录号（合并失败重试起点）
  confirmed: boolean; // 是否已确认（计入换蹄次数）
  mergeAttempts: number;
  lastError: string;
  baseHooves?: Record<HoofPosition, HoofPositionState>; // 最后同步状态（三路合并基准）
  createdAt: number;
  updatedAt: number;
}

/** 复查计划 */
export interface ReviewPlan {
  id: string;
  horseId: string;
  recordNo: string;
  reviewDate: string; // 下次复查日期
  reason: string;
  invalid: boolean; // 复查日期变化 → 失效重算
  createdAt: number;
  updatedAt: number;
}

/** 兽医意见 */
export interface VetOpinion {
  id: string;
  recordNo: string;
  horseId: string;
  position: HoofPosition;
  painScore: number;
  signed: boolean;
  invalid: boolean; // 失效
  createdAt: number;
}

/** 复查通知（处置后才生成） */
export interface ReviewNotification {
  id: string;
  horseId: string;
  recordNo: string;
  reviewDate: string;
  reason: string;
  handled: boolean; // 已处置（兽医已签字锁定）
  invalid: boolean;
  createdAt: number;
}

export interface ConflictInfo {
  recordNo: string;
  horseId: string;
  position: HoofPosition;
  kept: "vet";
  reason: string;
}

export interface MergeLogEntry {
  id: string;
  time: number;
  recordNo: string;
  result: "success" | "failed" | "retry";
  message: string;
}

export interface AppState {
  horses: Record<string, Horse>;
  records: Record<string, HoofRecord>; // 门诊正式库（兽医签字）
  localRecords: Record<string, HoofRecord>; // 蹄铁师离线草稿（按记录号索引）
  plans: Record<string, ReviewPlan>;
  opinions: Record<string, VetOpinion>;
  notifications: Record<string, ReviewNotification>;
  conflicts: ConflictInfo[];
  mergeLog: MergeLogEntry[];
  online: boolean;
  seq: { record: number; baseline: number; plan: number; opinion: number; notification: number };
}
