// 状态管理：蹄铁师离线草稿库（localRecords）+ 兽医门诊正式库（records），回网按记录号合并
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AppState,
  HoofPosition,
  HoofRecord,
  Horse,
  ReviewPlan,
} from "./types";
import { buildSeedState } from "./seed";
import {
  createBaselineNo,
  createRecordNo,
  emptyHoof,
  farrierEditPosition,
  findByRecordNo,
  invalidateForHorse,
  mergeRecordPair3Way,
  retryMerge,
  signAndLockPosition,
  supplementBaselines,
  uid,
} from "./engine";

const STORAGE_KEY = "hoof-archive-state-v2";

interface StoreContextValue {
  state: AppState;
  // 马匹
  addHorse: (h: Omit<Horse, "id" | "createdAt" | "updatedAt" | "baselineNo" | "baselineMissing">) => void;
  updateHorse: (id: string, patch: Partial<Horse>) => void;
  supplementBaselines: () => void;
  // 蹄铁师（离线草稿）
  createLocalRecord: (horseId: string, date: string) => string;
  farrierEditHoof: (recordNo: string, pos: HoofPosition, patch: Partial<HoofRecord["hooves"][HoofPosition]>) => { ok: boolean; error?: string };
  // 兽医（门诊正式库）
  vetSign: (recordNo: string, pos: HoofPosition, painScore: number) => void;
  // 合并
  mergeLocal: (recordNo: string) => { ok: boolean; message: string };
  mergeAll: () => void;
  simulateFailure: (recordNo: string) => void;
  retryRecord: (recordNo: string) => void;
  // 复查计划
  addPlan: (horseId: string, recordNo: string, reviewDate: string, reason: string) => void;
  updatePlan: (id: string, patch: Partial<ReviewPlan>) => void;
  setOnline: (v: boolean) => void;
  reset: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    /* ignore */
  }
  return buildSeedState();
}

/** 门诊正式库中按记录号查找 */
function findCanonical(s: AppState, recordNo: string): HoofRecord | undefined {
  return Object.values(s.records).find((r) => r.recordNo === recordNo);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const value = useMemo<StoreContextValue>(() => {
    const now = () => Date.now();

    const addHorse: StoreContextValue["addHorse"] = (h) => {
      setState((s) => {
        const id = uid("H");
        const baselineNo = createBaselineNo(s.seq.baseline + 1);
        const horse: Horse = {
          ...h,
          id,
          baselineNo,
          baselineMissing: false,
          createdAt: now(),
          updatedAt: now(),
        };
        return {
          ...s,
          horses: { ...s.horses, [id]: horse },
          seq: { ...s.seq, baseline: s.seq.baseline + 1 },
        };
      });
    };

    const updateHorse: StoreContextValue["updateHorse"] = (id, patch) => {
      setState((s) => {
        const prev = s.horses[id];
        if (!prev) return s;
        const updated: Horse = { ...prev, ...patch, updatedAt: now() };
        // 档案变化 → 已签意见和通知立即失效重算
        const inv = invalidateForHorse(s, id, now());
        return {
          ...s,
          horses: { ...s.horses, [id]: updated },
          ...inv,
        };
      });
    };

    const supplementBaselinesAction: StoreContextValue["supplementBaselines"] = () => {
      setState((s) => ({ ...s, ...supplementBaselines(s, now()) }));
    };

    const createLocalRecord: StoreContextValue["createLocalRecord"] = (horseId, date) => {
      const recordNo = createRecordNo(state.seq.record + 1);
      setState((s) => {
        const hooves = { LF: emptyHoof(), RF: emptyHoof(), LH: emptyHoof(), RH: emptyHoof() };
        const record: HoofRecord = {
          id: uid("R"),
          recordNo,
          horseId,
          date,
          hooves,
          side: "farrier",
          syncStatus: "local",
          basedOnRecordNo: recordNo,
          confirmed: false,
          mergeAttempts: 0,
          lastError: "",
          createdAt: now(),
          updatedAt: now(),
        };
        return {
          ...s,
          localRecords: { ...s.localRecords, [recordNo]: record },
          seq: { ...s.seq, record: s.seq.record + 1 },
        };
      });
      return recordNo;
    };

    const farrierEditHoof: StoreContextValue["farrierEditHoof"] = (recordNo, pos, patch) => {
      let result: { ok: boolean; error?: string } = { ok: true };
      setState((s) => {
        // 蹄铁师编辑离线草稿；若草稿不存在，则从门诊正式库复制一份作为离线草稿
        let draft = s.localRecords[recordNo];
        if (!draft) {
          const canonical = findCanonical(s, recordNo);
          if (!canonical) {
            result = { ok: false, error: "未找到记录，请先新增修蹄记录" };
            return s;
          }
          draft = {
            ...canonical,
            id: uid("R"),
            side: "farrier",
            syncStatus: "local",
            confirmed: false,
            mergeAttempts: 0,
            lastError: "",
            updatedAt: now(),
          };
        }
        // 越权拒绝：直接修改已锁定蹄位（绕过签名）→ 拒绝
        const r = farrierEditPosition(draft, pos, patch, now());
        if (!r.ok || !r.record) {
          result = { ok: false, error: r.error };
          return s;
        }
        result = { ok: true };
        return { ...s, localRecords: { ...s.localRecords, [recordNo]: r.record } };
      });
      return result;
    };

    const vetSign: StoreContextValue["vetSign"] = (recordNo, pos, painScore) => {
      setState((s) => {
        const target = findCanonical(s, recordNo) ?? findByRecordNo(s, recordNo);
        if (!target) return s;
        const { record, opinion } = signAndLockPosition(target, pos, painScore, now());
        return {
          ...s,
          records: { ...s.records, [target.id]: record },
          opinions: { ...s.opinions, [opinion.id]: opinion },
          seq: { ...s.seq, opinion: s.seq.opinion + 1 },
        };
      });
    };

    const mergeLocal: StoreContextValue["mergeLocal"] = (recordNo) => {
      let message = "";
      let ok = true;
      setState((s) => {
        const local = s.localRecords[recordNo];
        if (!local) {
          ok = false;
          message = "未找到离线草稿";
          return s;
        }
        const canonical = findCanonical(s, recordNo);
        const plan = Object.values(s.plans).find((p) => p.recordNo === recordNo && !p.invalid);
        // 三路合并：base=最后同步状态，local=蹄铁师离线版，remote=兽医门诊版
        const base = local.baseHooves
          ? ({ ...local, hooves: local.baseHooves } as HoofRecord)
          : undefined;
        const { record, conflicts, notifications } = mergeRecordPair3Way(
          base,
          local,
          canonical ?? local,
          plan?.reviewDate,
          now()
        );
        const log = {
          id: uid("LOG"),
          time: now(),
          recordNo,
          result: "success" as const,
          message: canonical
            ? `合并成功：${conflicts.length} 个蹄位冲突待处理，生成 ${notifications.length} 条复查通知`
            : `离线记录已并入门诊正式库，生成 ${notifications.length} 条复查通知`,
        };
        message = log.message;
        // 合并后：正式库存合并结果；离线草稿保留为最后同步状态（baseHooves 已更新）
        const nextRecords = { ...s.records };
        if (canonical) {
          nextRecords[canonical.id] = record;
        } else {
          nextRecords[record.id] = record;
        }
        return {
          ...s,
          records: nextRecords,
          localRecords: { ...s.localRecords, [recordNo]: record },
          conflicts: [...s.conflicts, ...conflicts],
          notifications: {
            ...s.notifications,
            ...Object.fromEntries(notifications.map((n) => [n.id, n])),
          },
          mergeLog: [log, ...s.mergeLog],
          seq: { ...s.seq, notification: s.seq.notification + notifications.length },
        };
      });
      return { ok, message };
    };

    const mergeAll: StoreContextValue["mergeAll"] = () => {
      setState((s) => {
        const locals = Object.values(s.localRecords).filter((r) => r.syncStatus === "local");
        if (locals.length === 0) return s;
        let next = s;
        for (const local of locals) {
          const canonical = findCanonical(next, local.recordNo);
          const plan = Object.values(next.plans).find((p) => p.recordNo === local.recordNo && !p.invalid);
          const base = local.baseHooves
            ? ({ ...local, hooves: local.baseHooves } as HoofRecord)
            : undefined;
          const { record, conflicts, notifications } = mergeRecordPair3Way(
            base,
            local,
            canonical ?? local,
            plan?.reviewDate,
            now()
          );
          const log = {
            id: uid("LOG"),
            time: now(),
            recordNo: local.recordNo,
            result: "success" as const,
            message: canonical
              ? `合并成功：${conflicts.length} 个蹄位冲突待处理，生成 ${notifications.length} 条复查通知`
              : `离线记录已并入门诊正式库，生成 ${notifications.length} 条复查通知`,
          };
          const nextRecords = { ...next.records };
          if (canonical) {
            nextRecords[canonical.id] = record;
          } else {
            nextRecords[record.id] = record;
          }
          next = {
            ...next,
            records: nextRecords,
            localRecords: { ...next.localRecords, [local.recordNo]: record },
            conflicts: [...next.conflicts, ...conflicts],
            notifications: {
              ...next.notifications,
              ...Object.fromEntries(notifications.map((n) => [n.id, n])),
            },
            mergeLog: [log, ...next.mergeLog],
          };
        }
        return next;
      });
    };

    const simulateFailure: StoreContextValue["simulateFailure"] = (recordNo) => {
      setState((s) => {
        const target = findCanonical(s, recordNo) ?? s.localRecords[recordNo];
        if (!target) return s;
        const log = {
          id: uid("LOG"),
          time: now(),
          recordNo,
          result: "failed" as const,
          message: "合并失败：网络中断，需从最后确认记录按原号重试",
        };
        const updated = { ...target, syncStatus: "failed" as const, lastError: "网络中断" };
        if (s.localRecords[recordNo]) {
          return {
            ...s,
            localRecords: { ...s.localRecords, [recordNo]: updated },
            mergeLog: [log, ...s.mergeLog],
          };
        }
        return {
          ...s,
          records: { ...s.records, [target.id]: updated },
          mergeLog: [log, ...s.mergeLog],
        };
      });
    };

    const retryRecord: StoreContextValue["retryRecord"] = (recordNo) => {
      setState((s) => {
        const target = findCanonical(s, recordNo) ?? s.localRecords[recordNo];
        if (!target) return s;
        const r = retryMerge(s, recordNo, now());
        if (!r.ok || !r.record) return s;
        const log = {
          id: uid("LOG"),
          time: now(),
          recordNo,
          result: "retry" as const,
          message: `从最后确认记录 ${r.record.basedOnRecordNo} 按原号 ${recordNo} 重试成功，换蹄次数不重复计入`,
        };
        if (s.localRecords[recordNo]) {
          return {
            ...s,
            localRecords: { ...s.localRecords, [recordNo]: r.record },
            mergeLog: [log, ...s.mergeLog],
          };
        }
        return {
          ...s,
          records: { ...s.records, [target.id]: r.record },
          mergeLog: [log, ...s.mergeLog],
        };
      });
    };

    const addPlan: StoreContextValue["addPlan"] = (horseId, recordNo, reviewDate, reason) => {
      setState((s) => {
        const plan: ReviewPlan = {
          id: uid("P"),
          horseId,
          recordNo,
          reviewDate,
          reason,
          invalid: false,
          createdAt: now(),
          updatedAt: now(),
        };
        return {
          ...s,
          plans: { ...s.plans, [plan.id]: plan },
          seq: { ...s.seq, plan: s.seq.plan + 1 },
        };
      });
    };

    const updatePlan: StoreContextValue["updatePlan"] = (id, patch) => {
      setState((s) => {
        const prev = s.plans[id];
        if (!prev) return s;
        const updated: ReviewPlan = { ...prev, ...patch, updatedAt: now() };
        // 复查日期变化 → 已签意见和通知立即失效重算
        const inv = invalidateForHorse(s, prev.horseId, now());
        return {
          ...s,
          plans: { ...s.plans, [id]: updated },
          ...inv,
        };
      });
    };

    const setOnline: StoreContextValue["setOnline"] = (v) => {
      setState((s) => ({ ...s, online: v }));
    };

    const reset: StoreContextValue["reset"] = () => {
      localStorage.removeItem(STORAGE_KEY);
      setState(buildSeedState());
    };

    return {
      state,
      addHorse,
      updateHorse,
      supplementBaselinesAction,
      createLocalRecord,
      farrierEditHoof,
      vetSign,
      mergeLocal,
      mergeAll,
      simulateFailure,
      retryRecord,
      addPlan,
      updatePlan,
      setOnline,
      reset,
    };
  }, [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
