import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { loadDB, saveDB, seedDB } from "./seed";
import type { DB, Role } from "./types";

export interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
}

export interface OpResult {
  ok: boolean;
  message: string;
  [k: string]: unknown;
}

interface Store {
  db: DB;
  role: Role;
  actor: string;
  toasts: Toast[];
  setRole: (r: Role) => void;
  setActor: (a: string) => void;
  /** 执行单个事务动作；失败时 toast 报错且库不变 */
  apply: (fn: (db: DB) => OpResult, success?: string) => OpResult;
  /** 顺序执行一批动作，模拟并发请求在同一 JS 线程内串行抢占；最终一次性落库 */
  burst: (ops: ((db: DB) => OpResult)[]) => OpResult[];
  resetData: () => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<Store | null>(null);

export const ROLE_LABEL: Record<Role, string> = {
  researcher: "研究员",
  keeper: "库管员",
  admin: "管理员",
};

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(() => loadDB());
  const [role, setRole] = useState<Role>("researcher");
  const [actor, setActor] = useState("张三");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);
  const dbRef = useRef(db);
  dbRef.current = db;

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const commit = useCallback(
    (next: DB) => {
      dbRef.current = next;
      setDb(next);
      saveDB(next);
    },
    [setDb]
  );

  const apply = useCallback<Store["apply"]>(
    (fn, success) => {
      const res = fn(dbRef.current);
      if (res.ok) {
        commit(res.db as DB);
        pushToast("ok", success || res.message);
      } else {
        pushToast("err", res.message);
      }
      return res;
    },
    [commit, pushToast]
  );

  const burst = useCallback<Store["burst"]>(
    (ops) => {
      // 关键：所有请求基于同一“已提交”快照起步并串行抢占 —— 模拟并发请求抵达服务端后的加锁顺序
      let current = dbRef.current;
      const results: OpResult[] = [];
      for (const op of ops) {
        const r = op(current);
        current = r.db as DB; // 失败事务返回原快照，等于自动让出抢占
        results.push(r);
      }
      commit(current);
      for (const r of results) pushToast(r.ok ? "ok" : "err", r.message);
      return results;
    },
    [commit, pushToast]
  );

  const resetData = useCallback(() => {
    const fresh = seedDB();
    commit(fresh);
    pushToast("ok", "数据已重置为演示种子（刷新亦可恢复，数据存于 localStorage）");
  }, [commit, pushToast]);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<Store>(
    () => ({ db, role, actor, toasts, setRole, setActor, apply, burst, resetData, dismissToast }),
    [db, role, actor, toasts, apply, burst, resetData, dismissToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

/** 把引擎返回值包装成统一 OpResult */
export function wrap<T extends { db: DB; error?: string }>(
  r: T,
  okMessage: string,
  extra?: Partial<OpResult>
): OpResult {
  if (r.error) return { ok: false, message: r.error, db: r.db };
  return { ok: true, message: okMessage, db: r.db, ...extra };
}
