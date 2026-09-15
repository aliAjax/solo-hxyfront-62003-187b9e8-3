import { useState } from "react";
import { useStore } from "../store";
import { ACTION_LABEL, STATUS_LABEL } from "../engine";
import type { OrderAction } from "../types";
import { StatusBadge, fmtTime } from "../ui";

const ACTION_TONE: Record<OrderAction, string> = {
  create: "blue",
  reserve: "blue",
  issue: "amber",
  return: "green",
  consume: "violet",
  close: "green",
  cancel: "muted",
  recall_freeze: "red",
  reject: "red",
};

export default function Audit() {
  const { db } = useStore();
  const [pick, setPick] = useState(db.orders[0]?.id ?? "");

  const selected = db.orders.find((o) => o.id === pick) ?? db.orders[0];

  const timeline = [...db.orders]
    .flatMap((o) =>
      o.audit.map((a) => ({
        orderId: o.id,
        status: o.status,
        applicant: o.applicant,
        ...a,
      }))
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="view split">
      <section className="panel">
        <div className="heading">
          <div>
            <p>只读审计记录</p>
            <h2>全库操作时间线（含被拦截的失败尝试）</h2>
          </div>
        </div>
        {timeline.length === 0 && <p className="empty">尚无操作记录。</p>}
        <div className="timeline">
          {timeline.map((t, i) => (
            <article key={i} className={`tl-item ${t.rejected ? "rejected" : ""}`} data-testid={`tl-${i}`}>
              <i className={`tl-dot tone-${ACTION_TONE[t.action]}`} />
              <div>
                <header>
                  <span className={`badge tone-${ACTION_TONE[t.action]}`}>{ACTION_LABEL[t.action]}</span>
                  <b className="mono">{t.orderId}</b>
                  <span className="muted small">{fmtTime(t.at)}</span>
                  <span className="muted small">操作人：{t.actor}</span>
                </header>
                <p className={t.rejected ? "form-error" : ""}>{t.detail}</p>
                {t.rejected && <p className="form-error small">拦截原因：{t.rejected}</p>}
              </div>
            </article>
          ))}
        </div>

        <div className="heading" style={{ marginTop: 26 }}>
          <div>
            <p>批次召回记录</p>
            <h2>召回令与受影响单据（冻结后只读保留）</h2>
          </div>
        </div>
        {db.recalls.length === 0 && <p className="empty">暂无召回。</p>}
        <div className="recall-list">
          {db.recalls.map((r) => (
            <article key={r.id} className="recall-card" data-testid={`recall-${r.id}`}>
              <header>
                <b className="mono">{r.id}</b>
                <span className="badge tone-red">批次 {r.batchId} 召回</span>
                <span className="muted small">{fmtTime(r.createdAt)} · {r.operator}</span>
              </header>
              <p>{r.reason}</p>
              <p className="small">
                冻结单据：
                {r.affectedOrders.length ? r.affectedOrders.map((id) => (
                  <span key={id} className="badge tone-red margin-r">{id}</span>
                )) : "无在途单据"}
              </p>
            </article>
          ))}
        </div>
      </section>

      <aside className="panel side-form">
        <p className="side-kicker">单据档案（只读）</p>
        <h2>选择单据</h2>
        <select value={selected?.id ?? ""} onChange={(e) => setPick(e.target.value)} data-testid="audit-pick">
          {db.orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id} · {STATUS_LABEL[o.status]} · {o.applicant}
            </option>
          ))}
        </select>
        {selected && (
          <div className="order-dossier" data-testid="dossier">
            <div className="row-actions wrap">
              <StatusBadge s={selected.status} />
              <span className="muted small">版本 v{selected.version}</span>
            </div>
            <p className="small muted">
              {selected.id} · 申请人 {selected.applicant} · 建单 {fmtTime(selected.createdAt)}
            </p>
            {selected.frozenReason && <p className="form-error">⛔ {selected.frozenReason}</p>}
            <h4>申请明细</h4>
            <ul className="dossier-list">
              {selected.items.map((it, i) => {
                const r = db.reagents.find((x) => x.id === it.reagentId)!;
                return <li key={i}>{r.name} × {it.qty}{r.unit}</li>;
              })}
            </ul>
            <h4>FIFO 批次占用</h4>
            {selected.allocations.length ? (
              <ul className="dossier-list">
                {selected.allocations.map((a) => (
                  <li key={a.batchId} className="mono">{a.batchId} × {a.qty}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">无（未预留或已取消/召回释放）</p>
            )}
            <h4>数量对账</h4>
            <p className="small">
              发放 {selected.issuedQty} · 归还 {selected.returnedQty} · 消耗 {selected.consumedQty}
            </p>
            <h4>状态流转审计（{selected.audit.length} 条）</h4>
            <ol className="audit-entries">
              {selected.audit.map((a, i) => (
                <li key={i} data-testid={`dossier-entry-${i}`}>
                  <span className={`badge tone-${ACTION_TONE[a.action]}`}>{ACTION_LABEL[a.action]}</span>
                  <span className="muted small">{fmtTime(a.at)} · {a.actor}</span>
                  <p className={a.rejected ? "form-error small" : "small"}>{a.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
