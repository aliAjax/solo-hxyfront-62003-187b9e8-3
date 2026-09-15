import { useStore } from "../store";
import { GROUP_LABEL, HAZARD_LABEL } from "../types";
import { batchStateTone, ExpiryBadge, HazardBadge } from "../ui";
import { isExpired } from "../engine";

export default function Locations() {
  const { db } = useStore();

  return (
    <div className="view">
      <section className="panel">
        <div className="heading">
          <div>
            <p>库位视图</p>
            <h2>按安全柜分区查看（反应组限制 · 混存相容 · 容量）</h2>
          </div>
          <div className="legend">
            <i className="dot green" /> 在库可用
            <i className="dot amber" /> 临期
            <i className="dot red" /> 过期/召回
            <i className="dot gray" /> 冻结/用尽
          </div>
        </div>

        <div className="loc-grid">
          {db.locations.map((loc) => {
            const batches = db.batches.filter((b) => b.locationId === loc.id);
            const pct = Math.round((batches.length / loc.capacity) * 100);
            return (
              <article key={loc.id} className={`loc-card ${pct >= 100 ? "full" : ""}`} data-testid={`loc-${loc.id}`}>
                <header>
                  <div>
                    <h3>{loc.name}</h3>
                    <small>{loc.id} · {loc.zone}</small>
                  </div>
                  <span className="cap">
                    {batches.length}/{loc.capacity}
                  </span>
                </header>
                <div className="loc-cap-bar">
                  <i style={{ width: Math.min(100, pct) + "%" }} />
                </div>
                <p className="groups">
                  允许反应组：{loc.groups.map((g) => GROUP_LABEL[g]).join("、")}
                </p>
                <div className="loc-slots">
                  {Array.from({ length: loc.capacity }).map((_, i) => {
                    const b = batches[i];
                    if (!b) return <div key={i} className="slot empty">空位</div>;
                    const r = db.reagents.find((x) => x.id === b.reagentId)!;
                    const tone = batchStateTone(b);
                    return (
                      <div key={i} className={`slot ${tone}`} data-testid={`slot-${b.id}`}>
                        <div className="slot-head">
                          <b>{r.name}</b>
                          <span className="mono">{b.id}</span>
                        </div>
                        <div className="tag-line">
                          <HazardBadge h={r.hazard} label={HAZARD_LABEL[r.hazard]} />
                        </div>
                        <div className="slot-qty">
                          剩 {b.remainingQty}
                          {r.unit} · 可用 {b.remainingQty - b.reservedQty}
                        </div>
                        <ExpiryBadge b={b} />
                        {(b.status === "frozen" || b.status === "recalled") && (
                          <small className="mini-warn">{b.frozenReason ?? (b.status === "recalled" ? "已召回" : "冻结")}</small>
                        )}
                        {b.status === "active" && isExpired(b) && <small className="mini-warn">过期批次禁止发放</small>}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
