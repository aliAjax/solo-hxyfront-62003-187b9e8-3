import { useStore } from "../store";
import { daysToExpiry, effectiveExpiry, isExpired } from "../engine";
import { ExpiryBadge, HazardBadge } from "../ui";
import { HAZARD_LABEL } from "../types";
import type { Batch } from "../types";

export default function Dashboard() {
  const { db } = useStore();
  const live = db.batches.filter((b) => b.status !== "exhausted");

  const expired = live.filter((b) => b.status === "active" && isExpired(b));
  const week = live.filter((b) => b.status === "active" && !isExpired(b) && daysToExpiry(b) <= 7);
  const month = live.filter(
    (b) => b.status === "active" && daysToExpiry(b) > 7 && daysToExpiry(b) <= 30
  );
  const lowStock = live.filter((b) => {
    const r = db.reagents.find((x) => x.id === b.reagentId)!;
    return b.status === "active" && b.remainingQty - b.reservedQty <= r.warnLine;
  });
  const recalled = live.filter((b) => b.status === "recalled");
  const frozen = live.filter((b) => b.status === "frozen");
  const activeOrders = db.orders.filter((o) =>
    ["draft", "reserved", "issued", "partial_return"].includes(o.status)
  ).length;

  const reagentName = (id: string) => db.reagents.find((r) => r.id === id)!;

  const cards = [
    { label: "在库批次", value: live.filter((b) => b.status === "active").length, tone: "blue", sub: `${db.reagents.length} 种试剂 · ${db.locations.length} 个库位` },
    { label: "已过期", value: expired.length, tone: "red", sub: "发放将被拦截" },
    { label: "7 日内到期", value: week.length, tone: "amber", sub: "今日到期当日仍可发放" },
    { label: "低于预警线", value: lowStock.length, tone: "violet", sub: "含可用量被预留占满" },
    { label: "召回/冻结", value: recalled.length + frozen.length, tone: "muted", sub: `${recalled.length} 召回 · ${frozen.length} 冻结` },
    { label: "进行中单据", value: activeOrders, tone: "green", sub: "申请/预留/发放/归还中" },
  ];

  const riskList = [...expired, ...week]
    .sort((a, b) => daysToExpiry(a) - daysToExpiry(b))
    .concat(month.sort((a, b) => daysToExpiry(a) - daysToExpiry(b)));

  return (
    <div className="view">
      <div className="metric-grid">
        {cards.map((c) => (
          <article key={c.label} className={`metric tone-${c.tone}`}>
            <small>{c.label}</small>
            <strong>{c.value}</strong>
            <span>{c.sub}</span>
          </article>
        ))}
      </div>

      <section className="panel">
        <div className="heading">
          <div>
            <p>效期风险看板</p>
            <h2>按到期紧迫度排序（含开封后效期收敛）</h2>
          </div>
          <div className="legend">
            <i className="dot red" /> 已过期
            <i className="dot amber" /> 7 日内
            <i className="dot blue" /> 30 日内
          </div>
        </div>
        {riskList.length === 0 && <p className="empty">当前没有 30 天内到期的批次。</p>}
        <div className="risk-list">
          {riskList.map((b: Batch) => {
            const r = reagentName(b.reagentId);
            const d = daysToExpiry(b);
            const cls = d < 0 ? "red" : d <= 7 ? "amber" : "blue";
            return (
              <article key={b.id} className={`risk-row ${cls}`}>
                <div>
                  <h3>
                    {r.name} <small>{b.id}</small>
                  </h3>
                  <p>
                    <HazardBadge h={r.hazard} label={HAZARD_LABEL[r.hazard]} /> 库位：
                    {db.locations.find((l) => l.id === b.locationId)?.name}
                    {b.openedAt && <> · 已于 {b.openedAt} 开封{ b.openStableDays != null ? `（开封后稳定 ${b.openStableDays} 天）` : ""}</>}
                  </p>
                </div>
                <div className="risk-right">
                  <ExpiryBadge b={b} />
                  <small>
                    标称效期 {b.expiresAt} → 实际截止 <b>{effectiveExpiry(b)}</b>
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>库存预警</p>
            <h2>剩余量低于预警线的批次</h2>
          </div>
        </div>
        {lowStock.length === 0 && <p className="empty">库存均高于预警线。</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>批次</th><th>试剂</th><th>可用 / 剩余 / 预警线</th><th>库位</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((b) => {
                const r = reagentName(b.reagentId);
                return (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td>{r.name}</td>
                    <td>
                      {b.remainingQty - b.reservedQty} / {b.remainingQty} {r.unit}
                      <span className="warn-line">预警线 {r.warnLine}</span>
                    </td>
                    <td>{db.locations.find((l) => l.id === b.locationId)?.name}</td>
                    <td><ExpiryBadge b={b} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
