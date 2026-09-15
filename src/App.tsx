import { useState } from "react";
import { StoreProvider, useStore, ROLE_LABEL } from "./store";
import Dashboard from "./views/Dashboard";
import Inventory from "./views/Inventory";
import Locations from "./views/Locations";
import Orders from "./views/Orders";
import Audit from "./views/Audit";
import type { Role } from "./types";

type Tab = "dashboard" | "orders" | "inventory" | "locations" | "audit";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "效期看板" },
  { key: "orders", label: "领用工作台" },
  { key: "inventory", label: "库存批次" },
  { key: "locations", label: "库位视图" },
  { key: "audit", label: "审计档案" },
];

const ROLES: Role[] = ["researcher", "keeper", "admin"];

function Shell() {
  const { role, setRole, actor, setActor, toasts, dismissToast, resetData } = useStore();
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">☣</span>
          <div>
            <h1>危化试剂库房管理台</h1>
            <p>FIFO 跨批次占用 · 效期/冻结/相容性拦截 · 单据状态机 · 事务回滚 · 召回冻结</p>
          </div>
        </div>
        <div className="role-box">
          <label className="inline">
            <span>当前身份</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="role-select">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            <span>操作人</span>
            <input value={actor} onChange={(e) => setActor(e.target.value)} data-testid="actor-input" />
          </label>
          <button className="btn-sm" onClick={resetData} data-testid="reset-data">
            重置演示数据
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)} data-testid={`tab-${t.key}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard />}
      {tab === "orders" && <Orders />}
      {tab === "inventory" && <Inventory />}
      {tab === "locations" && <Locations />}
      {tab === "audit" && <Audit />}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
            <b>{t.kind === "ok" ? "✓ 操作成功" : "⛔ 操作被拦截"}</b>
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      <footer className="foot">
        数据保存在浏览器 localStorage（刷新自动恢复）· 所有写操作经事务引擎执行，失败零副作用
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
