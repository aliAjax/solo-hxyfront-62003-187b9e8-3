import { useMemo, useState } from "react";
import { useStore, wrap } from "../store";
import {
  ACTION_LABEL,
  can,
  cancelOrder,
  closeOrder,
  consumeOrder,
  createOrder,
  issueOrder,
  outstanding,
  planAllocation,
  reagentsIncompatible,
  rejectOrder,
  reserveOrder,
  returnOrder,
  submitOrder,
} from "../engine";
import { HAZARD_LABEL } from "../types";
import type { DB, Order, OrderItem, Role } from "../types";
import { StatusBadge, Badge } from "../ui";

interface Line extends OrderItem {
  key: number;
}

const SIM_USERS = ["张三", "李四", "王五", "赵六"];

export default function Orders() {
  const { db, role, actor, apply, burst } = useStore();
  const [lines, setLines] = useState<Line[]>([{ key: 1, reagentId: "REA-005", qty: 400 }]);
  const [applicant, setApplicant] = useState(actor);
  const [idemKey, setIdemKey] = useState("K-1");
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [consumeQty, setConsumeQty] = useState<Record<string, number>>({});
  const [simLog, setSimLog] = useState<string[]>([]);

  const reagentById = (id: string) => db.reagents.find((r) => r.id === id)!;

  const orderConflict = useMemo(() => {
    const chosen = lines.map((l) => reagentById(l.reagentId));
    for (let i = 0; i < chosen.length; i++)
      for (let j = i + 1; j < chosen.length; j++)
        if (reagentsIncompatible(chosen[i], chosen[j]))
          return `${chosen[i].name} 与 ${chosen[j].name} 不相容，申请将被拦截`;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, db.reagents]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function createDraft(atomic: boolean) {
    if (orderConflict) {
      apply(() => ({ ok: false, message: "相容性拦截：" + orderConflict, db }));
      return;
    }
    const items = lines.map((l) => ({ reagentId: l.reagentId, qty: l.qty }));
    if (atomic) {
      apply((d) => wrap(submitOrder(d, { applicant, items }, { actor, role }), "申请+预留原子完成（FIFO 已跨批次占用）"));
    } else {
      apply((d) => wrap(createOrder(d, { applicant, items }, { actor, role }), "申请单已创建，等待库管员预留"));
    }
  }

  // 并发领用：多个请求基于同一已提交快照串行抢占，只有能整体满足的请求成功
  function runConcurrent(reagentId: string, perQty: number, n: number) {
    const stamp = new Date().toLocaleTimeString();
    const logs: string[] = [
      `── ${stamp}｜${n} 个请求并发抵达：每人申请 ${reagentById(reagentId).name} ${perQty}mL ──`,
    ];
    let seq = 0;
    const ops = Array.from({ length: n }, (_, i) => (d: DB) => {
      const user = SIM_USERS[i % SIM_USERS.length];
      seq += 1;
      const r = submitOrder(d, { applicant: user, items: [{ reagentId, qty: perQty }] }, {
        actor: user,
        role: "researcher" as Role,
        idemKey: `sim-${stamp}-${i}`,
      });
      logs.push(
        r.error
          ? `请求${i + 1}(${user}) 被拒绝：${r.error}`
          : `请求${i + 1}(${user}) 成功：单据 ${r.orderId}`
      );
      return wrap(r, logs[logs.length - 1]);
    });
    const results = burst(ops);
    const okCount = results.filter((r) => r.ok).length;
    logs.push(`结果：${okCount}/${n} 成功，库存无负值，失败请求零副作用`);
    setSimLog((lg) => [...logs.reverse(), ...lg]);
  }

  return (
    <div className="view split">
      <section className="panel">
        <div className="heading">
          <div>
            <p>领用工作台</p>
            <h2>申请 → 预留 → 发放 → 归还/消耗 → 关闭</h2>
          </div>
        </div>

        <div className="order-list">
          {db.orders.length === 0 && <p className="empty">还没有申请单，在右侧新建。</p>}
          {db.orders.map((o) => (
            <article key={o.id} className="order-card" data-testid={`order-${o.id}`}>
              <header>
                <b className="mono">{o.id}</b>
                <StatusBadge s={o.status} />
              </header>
              <p>
                申请人 <b>{o.applicant}</b> ·{" "}
                {o.items
                  .map((i) => `${reagentById(i.reagentId).name}×${i.qty}${reagentById(i.reagentId).unit}`)
                  .join("、")}
              </p>
              <p className="muted small">
                发放 {o.issuedQty} · 归还 {o.returnedQty} · 消耗 {o.consumedQty} · 在途 {outstanding(o)} · v{o.version}
              </p>
              {o.frozenReason && <p className="form-error">⛔ {o.frozenReason}（只读终态）</p>}
              <OrderActions
                key={o.id}
                order={o}
                idemKey={idemKey}
                returnQty={returnQty[o.id] ?? 0}
                consumeQty={consumeQty[o.id] ?? 0}
                setReturnQty={(v) => setReturnQty((s) => ({ ...s, [o.id]: v }))}
                setConsumeQty={(v) => setConsumeQty((s) => ({ ...s, [o.id]: v }))}
              />
            </article>
          ))}
        </div>
      </section>

      <aside className="panel side-form">
        <p className="side-kicker">新建领用申请</p>
        <h2>选择试剂与数量</h2>
        <label>
          <span>申请人</span>
          <input value={applicant} onChange={(e) => setApplicant(e.target.value)} />
        </label>

        {lines.map((line) => {
          const r = reagentById(line.reagentId);
          const plan = planAllocation(db, line.reagentId, line.qty);
          return (
            <div key={line.key} className="line-box" data-testid={`line-${line.key}`}>
              <div className="line-head">
                <select value={line.reagentId} onChange={(e) => updateLine(line.key, { reagentId: e.target.value })}>
                  {db.reagents.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}（{HAZARD_LABEL[x.hazard]}）
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                />
                <span className="unit">{r.unit}</span>
                <button className="btn-sm" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== line.key))}>
                  删
                </button>
              </div>
              <div className="fifo-preview" data-testid={`fifo-${line.key}`}>
                {plan.allocations.length > 0 ? (
                  <p className="small ok">
                    FIFO 预览：{plan.allocations.map((a) => `${a.batchId}×${a.qty}`).join(" → ")}
                  </p>
                ) : (
                  <p className="small form-error">当前无可用批次</p>
                )}
                {plan.shortage > 0 && (
                  <p className="small form-error">
                    缺口 {plan.shortage}
                    {r.unit}，预留时整单回滚
                  </p>
                )}
                {plan.blocked.length > 0 && (
                  <p className="small form-error">拦截批次：{plan.blocked.join("；")}</p>
                )}
              </div>
            </div>
          );
        })}
        <button
          className="btn-sm"
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), reagentId: db.reagents[0].id, qty: 50 }])}
        >
          + 添加试剂行
        </button>

        {orderConflict && <p className="form-error">⛔ {orderConflict}</p>}

        <div className="row-actions wrap">
          <button className="primary" data-testid="submit-draft" onClick={() => createDraft(false)}>
            提交申请（待预留）
          </button>
          <button data-testid="submit-atomic" onClick={() => createDraft(true)}>
            申请并预留（原子）
          </button>
        </div>

        <hr />
        <p className="side-kicker">并发领用压测（验证无负库存）</p>
        <div className="sim-box">
          <button className="btn-sm" data-testid="sim-80-2" onClick={() => runConcurrent("REA-006", 80, 2)}>
            2 人各抢 80mL 丙酮（库存 100）
          </button>
          <button className="btn-sm" data-testid="sim-40-3" onClick={() => runConcurrent("REA-006", 40, 3)}>
            3 人各抢 40mL 丙酮（库存 100）
          </button>
        </div>
        {simLog.length > 0 && (
          <div className="sim-log" data-testid="sim-log">
            {simLog.map((l, i) => (
              <p key={i} className={l.includes("被拒绝") ? "err" : l.includes("成功：") ? "ok" : "muted"}>
                {l}
              </p>
            ))}
          </div>
        )}

        <hr />
        <p className="side-kicker">幂等 / 重复提交</p>
        <label className="inline">
          <span>幂等键前缀</span>
          <input value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
        </label>
        <p className="small muted">对同一待预留单先点「预留」再点「重放」，第二次携带相同键会被判重复提交。</p>
      </aside>
    </div>
  );
}

function OrderActions(props: {
  order: Order;
  idemKey: string;
  returnQty: number;
  consumeQty: number;
  setReturnQty: (v: number) => void;
  setConsumeQty: (v: number) => void;
}) {
  const { role, actor, apply } = useStore();
  const o = props.order;
  const ctx = { actor, role };

  if (o.status === "frozen") return <p className="small muted">召回冻结终态：写操作全部禁用，仅可在审计页查看只读记录。</p>;
  if (["closed", "cancelled"].includes(o.status)) return <p className="small muted">终态单据，只读。</p>;

  const btn = (label: string, fn: () => void, cls = "", testid?: string, disabled?: boolean) => (
    <button
      className={`btn-sm ${cls}`}
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        fn();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <div className="order-actions">
      {o.status === "draft" && can(role, "reserve") && (
        <>
          {btn(
            ACTION_LABEL.reserve,
            () => apply((d) => wrap(reserveOrder(d, o.id, { ...ctx, idemKey: `${props.idemKey}:${o.id}` }), `单据 ${o.id} 预留成功（FIFO）`)),
            "primary",
            `btn-reserve-${o.id}`
          )}
          {btn(
            "重复提交(连压2次)",
            () => {
              // 模拟双击/网络重发：同一幂等键同步连发两次，第二次必须被判重复提交
              const k = `${props.idemKey}:${o.id}`;
              apply((d) => wrap(reserveOrder(d, o.id, { ...ctx, idemKey: k }), `单据 ${o.id} 预留成功（FIFO）`));
              apply((d) => wrap(reserveOrder(d, o.id, { ...ctx, idemKey: k }), "不应成功"));
            },
            "",
            `btn-replay-${o.id}`
          )}
          {btn(
            "驳回",
            () => apply((d) => wrap(rejectOrder(d, o.id, ctx, "库管员审批不通过"), `单据 ${o.id} 已驳回`)),
            "danger",
            `btn-reject-${o.id}`
          )}
        </>
      )}
      {o.status === "reserved" &&
        can(role, "issue") &&
        btn(
          ACTION_LABEL.issue,
          () => apply((d) => wrap(issueOrder(d, o.id, ctx), `单据 ${o.id} 已发放出库，登记开封日`)),
          "primary",
          `btn-issue-${o.id}`
        )}
      {["issued", "partial_return"].includes(o.status) && (
        <div className="qty-row">
          {can(role, "return") && (
            <>
              <input
                type="number"
                min={0}
                max={outstanding(o)}
                placeholder="归还量"
                value={props.returnQty || ""}
                onChange={(e) => props.setReturnQty(Number(e.target.value))}
                data-testid={`return-input-${o.id}`}
              />
              {btn(
                ACTION_LABEL.return,
                () => apply((d) => wrap(returnOrder(d, o.id, props.returnQty, ctx), `归还 ${props.returnQty} 已回库`)),
                "",
                `btn-return-${o.id}`,
                !(props.returnQty > 0)
              )}
            </>
          )}
          {can(role, "consume") && (
            <>
              <input
                type="number"
                min={0}
                max={outstanding(o)}
                placeholder="消耗量"
                value={props.consumeQty || ""}
                onChange={(e) => props.setConsumeQty(Number(e.target.value))}
                data-testid={`consume-input-${o.id}`}
              />
              {btn(
                ACTION_LABEL.consume,
                () => apply((d) => wrap(consumeOrder(d, o.id, props.consumeQty, ctx), `已确认消耗 ${props.consumeQty}`)),
                "",
                `btn-consume-${o.id}`,
                !(props.consumeQty > 0)
              )}
            </>
          )}
        </div>
      )}
      {o.status === "consumed" &&
        can(role, "close") &&
        btn(
          ACTION_LABEL.close,
          () => apply((d) => wrap(closeOrder(d, o.id, ctx), `单据 ${o.id} 已关闭`)),
          "primary",
          `btn-close-${o.id}`
        )}
      {["draft", "reserved"].includes(o.status) &&
        can(role, "cancel") &&
        (role !== "researcher" || o.applicant === actor) &&
        btn(
          ACTION_LABEL.cancel + "(回滚)",
          () => apply((d) => wrap(cancelOrder(d, o.id, ctx, "人工取消"), `单据 ${o.id} 已取消，预留全部释放`)),
          "danger",
          `btn-cancel-${o.id}`
        )}
      {o.allocations.length > 0 && (
        <div className="alloc-line">
          {o.allocations.map((a) => (
            <Badge key={a.batchId} tone="blue">
              {a.batchId} × {a.qty}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
