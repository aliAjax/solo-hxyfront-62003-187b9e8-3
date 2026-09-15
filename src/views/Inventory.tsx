import { useMemo, useState } from "react";
import { useStore, wrap } from "../store";
import {
  addDays,
  addBatch,
  can,
  checkLocation,
  freezeBatch,
  isExpired,
  recallBatch,
  today,
} from "../engine";
import { ExpiryBadge, HazardBadge, batchStateTone, Badge } from "../ui";
import { GROUP_LABEL, HAZARD_LABEL } from "../types";

export default function Inventory() {
  const { db, role, actor, apply } = useStore();
  const [reagentId, setReagentId] = useState(db.reagents[0]?.id ?? "");
  const [locationId, setLocationId] = useState(db.locations[0]?.id ?? "");
  const [qty, setQty] = useState(200);
  const [days, setDays] = useState(365);
  const [openDays, setOpenDays] = useState(90);
  const [recallLot, setRecallLot] = useState<string | null>(null);
  const [recallReason, setRecallReason] = useState("供应商质量通报");

  const reagent = db.reagents.find((r) => r.id === reagentId);
  const loc = db.locations.find((l) => l.id === locationId);
  // 预览库位规则 / 混存相容性 / 容量错误（不写库，保存时仍会再次事务校验）
  const locError = reagent && loc ? checkLocation(db, loc, reagent) : null;

  const rows = useMemo(() => {
    return [...db.batches]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => {
        const r = db.reagents.find((x) => x.id === b.reagentId)!;
        const l = db.locations.find((x) => x.id === b.locationId)!;
        return { b, r, l };
      });
  }, [db]);

  function submitBatch() {
    if (!reagent || !loc) return;
    const T = today();
    const res = apply(
      (d) =>
        wrap(
          addBatch(
            d,
            {
              reagentId: reagent.id,
              locationId: loc.id,
              receivedAt: T,
              expiresAt: addDays(T, days),
              openedAt: null,
              openStableDays: openDays,
              initialQty: qty,
            },
            { actor, role }
          ),
          `批次已登记入库：${reagent.name} ${qty}${reagent.unit} → ${loc.name}`
        ),
    );
    if (res.ok) {
      setQty(200);
    }
  }

  return (
    <div className="view split">
      <section className="panel">
        <div className="heading">
          <div>
            <p>批次台账</p>
            <h2>试剂批次（FIFO 按效期升序占用）</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th>批次</th><th>试剂 / 危险特性</th><th>库位</th><th>入库</th><th>开封日</th>
                <th>剩余</th><th>预留</th><th>效期</th><th>状态/操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, r, l }) => {
                const available = b.remainingQty - b.reservedQty;
                const low = available <= r.warnLine;
                return (
                  <tr key={b.id} data-testid={`batch-row-${b.id}`}>
                    <td className="mono">{b.id}</td>
                    <td>
                      <b>{r.name}</b>
                      <div className="tag-line">
                        <HazardBadge h={r.hazard} label={HAZARD_LABEL[r.hazard]} />
                        <Badge tone="muted">{GROUP_LABEL[r.group]}</Badge>
                      </div>
                    </td>
                    <td>{l.name}</td>
                    <td>{b.receivedAt}</td>
                    <td>{b.openedAt ?? "—"}</td>
                    <td className={low ? "num-low" : ""}>
                      {b.remainingQty} {r.unit}
                      {low && <div className="mini-warn">低于预警线 {r.warnLine}</div>}
                    </td>
                    <td>{b.reservedQty > 0 ? <Badge tone="blue">{b.reservedQty} 预留</Badge> : "—"}</td>
                    <td><ExpiryBadge b={b} /></td>
                    <td>
                      <Badge tone={batchStateTone(b)}>
                        {b.status === "active"
                          ? isExpired(b)
                            ? "在库(已过期)"
                            : "在库"
                          : b.status === "frozen"
                            ? "冻结"
                            : b.status === "recalled"
                              ? "召回"
                              : "用尽"}
                      </Badge>
                      {b.frozenReason && <div className="mini-warn">{b.frozenReason}</div>}
                      <div className="row-actions">
                        {b.status === "active" && can(role, "recall_freeze") && (
                          <button className="btn-sm danger" data-testid={`recall-btn-${b.id}`} onClick={() => setRecallLot(b.id)}>
                            召回
                          </button>
                        )}
                        {b.status === "active" && can(role, "recall_freeze") && (
                          <button
                            className="btn-sm"
                            onClick={() =>
                              apply(
                                (d) => wrap(freezeBatch(d, b.id, "盘点异常临时冻结", { actor, role }), `批次 ${b.id} 已冻结`),
                              )
                            }
                          >
                            冻结
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="panel side-form">
        <p className="side-kicker">库管员操作</p>
        <h2>登记新批次</h2>
        <label>
          <span>试剂</span>
          <select value={reagentId} onChange={(e) => setReagentId(e.target.value)}>
            {db.reagents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}（{GROUP_LABEL[r.group]}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>库位（按反应组限制）</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {db.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.zone}
              </option>
            ))}
          </select>
        </label>
        {locError && <p className="form-error">⚠ {locError}（保存时会被拦截）</p>}
        <label>
          <span>初始数量</span>
          <input type="number" value={qty} min={1} onChange={(e) => setQty(Number(e.target.value))} />
        </label>
        <label>
          <span>效期（天数后）</span>
          <input type="number" value={days} min={1} onChange={(e) => setDays(Number(e.target.value))} />
          <small>到期日：{addDays(today(), days)}</small>
        </label>
        <label>
          <span>开封后稳定天数</span>
          <input type="number" value={openDays} min={1} onChange={(e) => setOpenDays(Number(e.target.value))} />
        </label>
        <button className="primary" data-testid="add-batch-btn" onClick={submitBatch}>
          登记入库（库位/相容性校验）
        </button>

        {recallLot && (
          <div className="modal-card" data-testid="recall-dialog">
            <h3>批次召回 {recallLot}</h3>
            <p className="muted">
              将冻结批次本身，并冻结所有占用该批次的申请/预留单（释放预留），历史审计保留只读。
            </p>
            <input value={recallReason} onChange={(e) => setRecallReason(e.target.value)} />
            <div className="row-actions">
              <button
                className="danger"
                data-testid="confirm-recall"
                onClick={() => {
                  const lot = recallLot;
                  const res = apply(
                    (d) => {
                      const r = recallBatch(d, lot, recallReason, { actor, role });
                      return wrap(r, `召回完成：${lot}，冻结单据 ${r.affected?.join("、") || "无在途单据"}`, {
                        recallId: r.recallId,
                      });
                    },
                  );
                  if (res.ok) setRecallLot(null);
                }}
              >
                确认召回
              </button>
              <button onClick={() => setRecallLot(null)}>取消</button>
            </div>
          </div>
        )}
        <p className="muted small">实际截止：{reagent ? "（见各行效期标签，开封后效期自动收敛）" : ""}</p>
        <p className="muted small">提示：用管理员/库管员身份操作；切换角色后越权操作会被拦截。</p>
      </aside>
    </div>
  );
}
