import React from "react";
import type { Batch, OrderStatus, HazardClass } from "./types";
import { daysToExpiry, effectiveExpiry } from "./engine";
import { STATUS_LABEL } from "./engine";

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function statusTone(s: OrderStatus): string {
  return {
    draft: "muted",
    reserved: "blue",
    issued: "amber",
    partial_return: "amber",
    consumed: "violet",
    closed: "green",
    cancelled: "muted",
    frozen: "red",
  }[s];
}

export function StatusBadge({ s }: { s: OrderStatus }) {
  return <Badge tone={statusTone(s)}>{STATUS_LABEL[s]}</Badge>;
}

const HAZ_TONE: Record<HazardClass, string> = {
  oxidizer: "amber",
  flammable: "red",
  acid: "violet",
  base: "blue",
  toxic: "red",
};

export function HazardBadge({ h, label }: { h: HazardClass; label: string }) {
  return <Badge tone={HAZ_TONE[h]}>{label}</Badge>;
}

/** 效期风险：已过期 / 7 天内 / 30 天内 / 正常 */
export function expiryRisk(b: Batch): { level: "expired" | "soon" | "watch" | "ok" | "frozen"; label: string } {
  if (b.status === "frozen" || b.status === "recalled") {
    return { level: "frozen", label: b.status === "recalled" ? "已召回" : "已冻结" };
  }
  const d = daysToExpiry(b);
  if (d < 0) return { level: "expired", label: `已过期 ${-d} 天` };
  if (d === 0) return { level: "soon", label: "今日到期" };
  if (d <= 7) return { level: "soon", label: `临期 ${d} 天` };
  if (d <= 30) return { level: "watch", label: `${d} 天后到期` };
  return { level: "ok", label: `${d} 天有效` };
}

export function ExpiryBadge({ b }: { b: Batch }) {
  const r = expiryRisk(b);
  const tone = r.level === "ok" ? "green" : r.level === "watch" ? "amber" : r.level === "frozen" ? "muted" : "red";
  return (
    <Badge tone={tone}>
      {r.label}（{effectiveExpiry(b)}）
    </Badge>
  );
}

export function batchStateTone(b: Batch): string {
  if (b.status === "recalled") return "red";
  if (b.status === "frozen") return "muted";
  if (b.status === "exhausted") return "muted";
  return expiryRisk(b).level === "expired" ? "red" : expiryRisk(b).level === "soon" ? "amber" : "green";
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

export function Progress({ value, max, danger }: { value: number; max: number; danger?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100));
  return (
    <div className={`progress${danger ? " danger" : ""}`}>
      <i style={{ width: pct + "%" }} />
    </div>
  );
}
