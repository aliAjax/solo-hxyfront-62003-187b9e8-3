// 危化试剂库房 —— 纯函数业务引擎（事务 / FIFO / 状态机 / 权限 / 审计）
import type {
  Allocation,
  Batch,
  DB,
  Location,
  Order,
  OrderAction,
  OrderStatus,
  ReactiveGroup,
  Reagent,
  Role,
} from "./types";

// ---------- 日期工具 ----------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

/** 开封后效期 = min(标称效期, 开封日 + 开封稳定期) */
export function effectiveExpiry(b: Batch): string {
  if (b.openedAt && b.openStableDays != null) {
    const openLimit = addDays(b.openedAt, b.openStableDays);
    return openLimit < b.expiresAt ? openLimit : b.expiresAt;
  }
  return b.expiresAt;
}

export function isExpired(b: Batch, day = today()): boolean {
  return effectiveExpiry(b) < day; // 到期当日仍可发放，次日判过期
}

export function daysToExpiry(b: Batch, day = today()): number {
  return diffDays(day, effectiveExpiry(b));
}

// ---------- 相容性 ----------

const MATRIX: Record<ReactiveGroup, ReactiveGroup[]> = {
  strong_oxidizer: ["strong_acid", "heavy_metal_salt"],
  strong_acid: ["strong_oxidizer", "strong_base", "heavy_metal_salt"],
  strong_base: ["strong_acid", "heavy_metal_salt"],
  heavy_metal_salt: ["strong_oxidizer", "strong_acid", "strong_base"],
  inert: [],
};

export function groupsIncompatible(a: ReactiveGroup, b: ReactiveGroup): boolean {
  if (a === b) return false;
  return MATRIX[a].includes(b) || MATRIX[b].includes(a);
}

export function reagentsIncompatible(r1: Reagent, r2: Reagent): boolean {
  if (r1.id === r2.id) return false;
  if (groupsIncompatible(r1.group, r2.group)) return true;
  if (r1.incompatibleGroups.includes(r2.group)) return true;
  if (r2.incompatibleGroups.includes(r1.group)) return true;
  return false;
}

/** 校验一张申请单中所有试剂两两相容；返回冲突描述 */
export function checkOrderCompatibility(db: DB, reagentIds: string[]): string | null {
  const list = reagentIds.map((id) => db.reagents.find((r) => r.id === id)!);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (reagentsIncompatible(list[i], list[j])) {
        return `相容性拦截：${list[i].name}(${list[i].group}) 与 ${list[j].name}(${list[j].group}) 禁止同单存放/领用`;
      }
    }
  }
  return null;
}

/** 库位是否可存放该试剂：库位允许该反应组，且与同库位既有批次不相冲突 */
export function checkLocation(db: DB, loc: Location, reagent: Reagent, ignoreBatchId?: string): string | null {
  if (!loc.groups.includes(reagent.group)) {
    return `库位规则拦截：${loc.name} 不允许存放 ${reagent.group}`;
  }
  for (const b of db.batches) {
    if (b.locationId !== loc.id || b.id === ignoreBatchId) continue;
    if (b.status === "exhausted") continue;
    const other = db.reagents.find((r) => r.id === b.reagentId)!;
    if (reagentsIncompatible(reagent, other)) {
      return `库位混存拦截：与同柜批次 ${b.id}(${other.name}) 不相容`;
    }
  }
  const used = db.batches.filter((b) => b.locationId === loc.id && b.id !== ignoreBatchId).length;
  if (used >= loc.capacity) return `库位容量拦截：${loc.name} 已达容量上限 ${loc.capacity}`;
  return null;
}

// ---------- FIFO 分配 ----------

export interface AvailableBatch {
  batch: Batch;
  available: number; // remainingQty - reservedQty
  days: number;
}

export function availableBatches(db: DB, reagentId: string, day = today()): AvailableBatch[] {
  return db.batches
    .filter((b) => b.reagentId === reagentId && b.status === "active")
    .map((batch) => ({
      batch,
      available: round(batch.remainingQty - batch.reservedQty),
      days: daysToExpiry(batch, day),
    }))
    .filter((x) => x.available > 0 && !isExpired(x.batch, day))
    .sort((a, b) =>
      a.days !== b.days ? a.days - b.days : a.batch.receivedAt < b.batch.receivedAt ? -1 : 1
    );
}

/** 单个试剂行的 FIFO 跨批次占用规划（不写库），同时汇总被拦截的批次 */
export function planAllocation(
  db: DB,
  reagentId: string,
  qty: number,
  day = today()
): { allocations: Allocation[]; shortage: number; blocked: string[] } {
  const blocked: string[] = [];
  for (const b of db.batches.filter((x) => x.reagentId === reagentId)) {
    const free = b.remainingQty - b.reservedQty > 0;
    if (!free) continue;
    if (b.status === "frozen" || b.status === "recalled") {
      blocked.push(`${b.id} 已${b.status === "recalled" ? "召回" : "冻结"}`);
    } else if (isExpired(b, day)) {
      blocked.push(`${b.id} 已于 ${effectiveExpiry(b)} 过期`);
    }
  }
  const allocations: Allocation[] = [];
  let need = qty;
  for (const cand of availableBatches(db, reagentId, day)) {
    if (need <= 0) break;
    const take = Math.min(cand.available, need);
    allocations.push({ batchId: cand.batch.id, qty: round(take) });
    need = round(need - take);
  }
  return { allocations, shortage: round(Math.max(0, need)), blocked };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------- 权限 ----------

const PERMISSIONS: Record<Role, OrderAction[]> = {
  researcher: ["create", "return", "consume", "cancel"],
  keeper: ["create", "reserve", "issue", "close", "cancel", "reject"],
  admin: ["create", "reserve", "issue", "return", "consume", "close", "cancel", "recall_freeze", "reject"],
};

export function can(role: Role, action: OrderAction): boolean {
  return PERMISSIONS[role].includes(action);
}

export const ACTION_LABEL: Record<OrderAction, string> = {
  create: "申请",
  reserve: "预留",
  issue: "发放",
  return: "部分归还",
  consume: "消耗确认",
  close: "关闭",
  cancel: "取消",
  recall_freeze: "召回冻结",
  reject: "驳回",
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "待预留",
  reserved: "已预留",
  issued: "已发放",
  partial_return: "部分归还",
  consumed: "已消耗",
  closed: "已关闭",
  cancelled: "已取消",
  frozen: "召回冻结",
};

// ---------- 状态机 ----------

const TRANSITIONS: Record<OrderAction, OrderStatus[]> = {
  create: [],
  reserve: ["draft"],
  issue: ["reserved"],
  return: ["issued", "partial_return"],
  consume: ["issued", "partial_return"],
  close: ["consumed"],
  cancel: ["draft", "reserved"],
  recall_freeze: ["draft", "reserved", "issued", "partial_return", "consumed"],
  reject: ["draft"],
};

// ---------- 事务 ----------

export class BizError extends Error {}

export function assert(cond: unknown, msg: string | (() => string)): asserts cond {
  if (!cond) throw new BizError(typeof msg === "function" ? msg() : msg);
}

/** 在深拷贝上执行；任一步抛错则整单回滚，返回原库不变 */
export function transaction<T>(db: DB, fn: (w: DB) => T): { db: DB; result: T | { error: string } } {
  const snapshot = structuredClone(db);
  try {
    const w = structuredClone(db);
    const result = fn(w);
    const inv = verifyInvariants(w);
    if (inv.length) throw new BizError("不变量校验失败：" + inv.join("；"));
    return { db: w, result };
  } catch (e) {
    return { db: snapshot, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

// ---------- 编号 ----------

function nextId(prefix: string, ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const n = Number(id.split("-")[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// ---------- 审计 ----------

function log(o: Order, action: OrderAction, actor: string, detail: string, rejected?: string) {
  o.audit.push({ at: new Date().toISOString(), action, actor, detail, rejected });
  o.updatedAt = new Date().toISOString();
}

// ---------- 不变量 ----------

export function verifyInvariants(db: DB): string[] {
  const errs: string[] = [];
  for (const b of db.batches) {
    if (b.reservedQty < -1e-9) errs.push(`${b.id} 预留量为负`);
    if (b.remainingQty < -1e-9) errs.push(`${b.id} 剩余量为负（超卖）`);
    if (b.reservedQty > b.remainingQty + 1e-9) errs.push(`${b.id} 预留量超过剩余量`);
  }
  for (const b of db.batches) {
    const held = db.orders
      .filter((o) => o.status === "reserved")
      .flatMap((o) => o.allocations)
      .filter((a) => a.batchId === b.id)
      .reduce((s, a) => s + a.qty, 0);
    if (held > b.remainingQty + 1e-6) errs.push(`批次 ${b.id} 并发预留超卖`);
  }
  return [...new Set(errs)];
}

// ===================================================================
// 业务动作
// ===================================================================

export interface ActionContext {
  actor: string;
  role: Role;
  /** 幂等键：同一单据重复携带相同键的动作直接判为重复提交 */
  idemKey?: string;
  day?: string;
}

function findOrder(db: DB, id: string): Order {
  const o = db.orders.find((x) => x.id === id);
  assert(o, `单据 ${id} 不存在`);
  return o;
}

function guardAction(o: Order, action: OrderAction, ctx: ActionContext) {
  assert(can(ctx.role, action), `越权拦截：角色 ${ctx.role} 无权执行「${ACTION_LABEL[action]}」`);
  if (ctx.idemKey && o.idempotencyKeys.includes(ctx.idemKey)) {
    throw new BizError(`重复提交拦截：键 ${ctx.idemKey} 已处理，本次请求无效`);
  }
  assert(
    TRANSITIONS[action].includes(o.status),
    `状态流转非法：${STATUS_LABEL[o.status]} 不能执行「${ACTION_LABEL[action]}」`
  );
  if (ctx.role === "researcher" && o.applicant !== ctx.actor) {
    throw new BizError("越权拦截：研究员只能操作本人的申请单");
  }
}

type TxResult = { db: DB; error?: string };

function unwrap(r: { db: DB; result: unknown }): TxResult {
  const res = r.result as { error?: string } | null;
  return { db: r.db, error: res && typeof res === "object" && "error" in res ? res.error : undefined };
}

// ---------- 1. 申请 ----------

export function createOrder(
  dbIn: DB,
  input: { applicant: string; items: { reagentId: string; qty: number }[] },
  ctx: ActionContext
): TxResult & { orderId?: string } {
  const r = transaction(dbIn, (w) => {
    assert(can(ctx.role, "create"), `越权拦截：角色 ${ctx.role} 无权申请领用`);
    assert(input.items.length > 0, "申请单至少包含一种试剂");
    for (const it of input.items) {
      assert(it.qty > 0, "领用数量必须大于 0");
      assert(w.reagents.some((r) => r.id === it.reagentId), `试剂 ${it.reagentId} 不存在`);
    }
    const conflict = checkOrderCompatibility(w, input.items.map((i) => i.reagentId));
    assert(!conflict, conflict!);

    const id = nextId(
      "ORD",
      w.orders.map((o) => o.id)
    );
    const now = new Date().toISOString();
    const order: Order = {
      id,
      applicant: input.applicant,
      items: input.items.map((i) => ({ ...i })),
      status: "draft",
      allocations: [],
      issuedQty: 0,
      returnedQty: 0,
      consumedQty: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
      idempotencyKeys: [],
      audit: [
        {
          at: now,
          action: "create",
          actor: ctx.actor,
          detail: `提交申请：${input.items
            .map((i) => w.reagents.find((r) => r.id === i.reagentId)!.name + "×" + i.qty + w.reagents.find((r) => r.id === i.reagentId)!.unit)
            .join("、")}`,
        },
      ],
    };
    w.orders.unshift(order);
    return { orderId: id };
  });
  const res = r.result as { orderId?: string; error?: string };
  return { db: r.db, error: res.error, orderId: res.orderId };
}

// ---------- 2. 预留（FIFO 跨批次，整单原子） ----------

export function reserveOrder(dbIn: DB, orderId: string, ctx: ActionContext): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "reserve", ctx);

      const conflict = checkOrderCompatibility(w, o.items.map((i) => i.reagentId));
      assert(!conflict, conflict!);

      const allAlloc: Allocation[] = [];
      const details: string[] = [];
      for (const item of o.items) {
        const plan = planAllocation(w, item.reagentId, item.qty, ctx.day);
        const reagent = w.reagents.find((x) => x.id === item.reagentId)!;
        assert(
          plan.shortage <= 0,
          `预留失败（整单回滚）：${reagent.name} 可用缺口 ${plan.shortage}${reagent.unit}${
            plan.blocked.length ? `（不可用批次：${plan.blocked.join("；")}）` : ""
          }`
        );
        // 事务内立即占用：同一申请单后续行与并发排队的后续单据都看到更新后的库存
        for (const a of plan.allocations) {
          const b = w.batches.find((x) => x.id === a.batchId)!;
          b.reservedQty = round(b.reservedQty + a.qty);
          assert(
            b.reservedQty <= b.remainingQty + 1e-9,
            `并发冲突：批次 ${b.id} 可用量已被其他单据抢先占用（整单回滚）`
          );
          allAlloc.push(a);
        }
        details.push(`${reagent.name} → ${plan.allocations.map((a) => `${a.batchId}×${a.qty}`).join("、")}`);
      }
      o.allocations = allAlloc;
      o.status = "reserved";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "reserve", ctx.actor, `FIFO 跨批次预留：${details.join("；")}`);
      return null;
    })
  );
}

// ---------- 2b. 申请并预留（单事务原子路径，供并发请求压测） ----------

export function submitOrder(
  dbIn: DB,
  input: { applicant: string; items: { reagentId: string; qty: number }[] },
  ctx: ActionContext
): TxResult & { orderId?: string } {
  const r = transaction(dbIn, (w) => {
    assert(can(ctx.role, "create"), `越权拦截：角色 ${ctx.role} 无权申请领用`);
    assert(input.items.length > 0, "申请单至少包含一种试剂");
    for (const it of input.items) {
      assert(it.qty > 0, "领用数量必须大于 0");
      assert(w.reagents.some((r) => r.id === it.reagentId), `试剂不存在`);
    }
    let conflict = checkOrderCompatibility(w, input.items.map((i) => i.reagentId));
    assert(!conflict, conflict!);

    const id = nextId("ORD", w.orders.map((o) => o.id));
    const now = new Date().toISOString();
    const order: Order = {
      id,
      applicant: input.applicant,
      items: input.items.map((i) => ({ ...i })),
      status: "reserved",
      allocations: [],
      issuedQty: 0,
      returnedQty: 0,
      consumedQty: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
      idempotencyKeys: [],
      audit: [
        {
          at: now,
          action: "create",
          actor: ctx.actor,
          detail: `提交申请：${input.items
            .map((i) => w.reagents.find((r) => r.id === i.reagentId)!.name + "×" + i.qty)
            .join("、")}`,
        },
      ],
    };
    w.orders.unshift(order);

    // 同一事务内立即 FIFO 预留；库存不足/过期/冻结/并发被抢 → 整单（含申请）回滚
    conflict = checkOrderCompatibility(w, order.items.map((i) => i.reagentId));
    assert(!conflict, conflict!);
    const details: string[] = [];
    for (const item of order.items) {
      const plan = planAllocation(w, item.reagentId, item.qty, ctx.day);
      const reagent = w.reagents.find((x) => x.id === item.reagentId)!;
      assert(
        plan.shortage <= 0,
        `申请预留失败（整单回滚）：${reagent.name} 可用缺口 ${plan.shortage}${reagent.unit}${
          plan.blocked.length ? `（不可用：${plan.blocked.join("；")}）` : ""
        }`
      );
      for (const a of plan.allocations) {
        const b = w.batches.find((x) => x.id === a.batchId)!;
        b.reservedQty = round(b.reservedQty + a.qty);
        assert(
          b.reservedQty <= b.remainingQty + 1e-9,
          `并发冲突：批次 ${b.id} 已被抢先占用（整单回滚）`
        );
        order.allocations.push(a);
      }
      details.push(`${reagent.name} → ${plan.allocations.map((a) => `${a.batchId}×${a.qty}`).join("、")}`);
    }
    if (ctx.idemKey) order.idempotencyKeys.push(ctx.idemKey);
    log(order, "reserve", ctx.actor, `申请即预留（原子）：${details.join("；")}`);
    return { orderId: id };
  });
  const res = r.result as { orderId?: string; error?: string };
  return { db: r.db, error: res.error, orderId: res.orderId };
}

// ---------- 3. 发放 ----------

export function issueOrder(dbIn: DB, orderId: string, ctx: ActionContext): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "issue", ctx);
      assert(o.allocations.length > 0, "发放失败：单据尚无预留分配");
      // 先全量校验，再统一扣减（两步之间不会有部分出库）
      for (const a of o.allocations) {
        const b = w.batches.find((x) => x.id === a.batchId)!;
        assert(b.status === "active", `发放失败（整单回滚）：批次 ${b.id} 已${b.status === "recalled" ? "被召回" : "冻结"}`);
        assert(!isExpired(b, ctx.day), `发放失败（整单回滚）：批次 ${b.id} 已于 ${effectiveExpiry(b)} 过期（效期边界拦截）`);
        assert(b.reservedQty + 1e-9 >= a.qty, `发放失败：批次 ${b.id} 预留量异常（并发冲突，整单回滚）`);
      }
      let total = 0;
      for (const a of o.allocations) {
        const b = w.batches.find((x) => x.id === a.batchId)!;
        b.reservedQty = round(b.reservedQty - a.qty);
        b.remainingQty = round(b.remainingQty - a.qty);
        total += a.qty;
        if (!b.openedAt) b.openedAt = ctx.day ?? today();
        if (b.remainingQty <= 0) b.status = "exhausted";
      }
      o.issuedQty = round(o.issuedQty + total);
      o.status = "issued";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "issue", ctx.actor, `实物发放 ${round(total)}，按预留批次出库，首次发放登记开封日`);
      return null;
    })
  );
}

/** 未归还也未确认消耗的在途数量 */
export function outstanding(o: Order): number {
  return round(o.issuedQty - o.returnedQty - o.consumedQty);
}

// ---------- 4. 部分归还 ----------

export function returnOrder(
  dbIn: DB,
  orderId: string,
  qty: number,
  ctx: ActionContext
): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "return", ctx);
      assert(qty > 0, "归还数量必须大于 0");
      assert(qty <= outstanding(o) + 1e-9, `归还超额：在途仅 ${outstanding(o)}，归还 ${qty} 将导致数据回滚`);

      // 按 FIFO 的反序（最后分配的批次优先）把实物退回到仍有效的批次；
      // 若原批次已召回/冻结/过期，则入回最近的可用批次（无可用批次则整单失败回滚）
      let need = qty;
      const reverse = [...o.allocations].reverse();
      const restoreTo: { batchId: string; qty: number }[] = [];
      for (const a of reverse) {
        if (need <= 0) break;
        const b = w.batches.find((x) => x.id === a.batchId)!;
        if (b.status === "active" && !isExpired(b, ctx.day)) {
          const take = Math.min(a.qty, need);
          restoreTo.push({ batchId: b.id, qty: round(take) });
          need = round(need - take);
        }
      }
      if (need > 0) {
        // 原批次不可退回，尝试同试剂的其他开封可用批次
        for (const item of o.items) {
          if (need <= 0) break;
          for (const cand of availableBatches(w, item.reagentId, ctx.day)) {
            if (need <= 0) break;
            const take = Math.min(need, cand.batch.initialQty - cand.batch.remainingQty);
            if (take > 0) {
              restoreTo.push({ batchId: cand.batch.id, qty: round(take) });
              need = round(need - take);
            }
          }
        }
      }
      assert(need <= 0, `归还失败（整单回滚）：原批次已召回/冻结/过期，且无可用批次接收 ${round(need)}`);
      for (const r of restoreTo) {
        const b = w.batches.find((x) => x.id === r.batchId)!;
        b.remainingQty = round(b.remainingQty + r.qty);
        if (b.status === "exhausted") b.status = "active";
      }
      o.returnedQty = round(o.returnedQty + qty);
      const allReturned = outstanding(o) <= 1e-9;
      o.status = allReturned ? "consumed" : "partial_return";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(
        o,
        "return",
        ctx.actor,
        `部分归还 ${qty}，回库：${restoreTo.map((r) => `${r.batchId}×${r.qty}`).join("、")}${allReturned ? "；在途已清零" : ""}`
      );
      return null;
    })
  );
}

// ---------- 5. 消耗确认 ----------

export function consumeOrder(
  dbIn: DB,
  orderId: string,
  qty: number,
  ctx: ActionContext
): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "consume", ctx);
      assert(qty > 0, "消耗数量必须大于 0");
      assert(qty <= outstanding(o) + 1e-9, `消耗超额：在途仅 ${outstanding(o)}（整单回滚）`);
      o.consumedQty = round(o.consumedQty + qty);
      const cleared = outstanding(o) <= 1e-9;
      o.status = "consumed";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "consume", ctx.actor, `确认实验消耗 ${qty}${cleared ? "；在途已清零，可关闭" : `；在途余量 ${outstanding(o)}`}`);
      return null;
    })
  );
}

// ---------- 6. 关闭 ----------

export function closeOrder(dbIn: DB, orderId: string, ctx: ActionContext): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "close", ctx);
      assert(outstanding(o) <= 1e-9, "关闭失败：仍有在途数量未归还/未确认消耗（整单回滚）");
      o.status = "closed";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "close", ctx.actor, "单据关闭，全流程完结");
      return null;
    })
  );
}

// ---------- 7. 取消（释放预留，整单回滚式撤销） ----------

export function cancelOrder(dbIn: DB, orderId: string, ctx: ActionContext, reason: string): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "cancel", ctx);
      if (o.status === "reserved") {
        for (const a of o.allocations) {
          const b = w.batches.find((x) => x.id === a.batchId)!;
          b.reservedQty = round(b.reservedQty - a.qty);
          assert(b.reservedQty >= -1e-9, `取消失败：批次 ${b.id} 预留量异常`);
        }
      }
      o.allocations = [];
      o.status = "cancelled";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "cancel", ctx.actor, `取消单据并释放全部预留库存：${reason}`);
      return null;
    })
  );
}

// ---------- 驳回（库管员拒绝申请） ----------

export function rejectOrder(dbIn: DB, orderId: string, ctx: ActionContext, reason: string): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      const o = findOrder(w, orderId);
      guardAction(o, "reject", ctx);
      o.status = "cancelled";
      o.version += 1;
      if (ctx.idemKey) o.idempotencyKeys.push(ctx.idemKey);
      log(o, "reject", ctx.actor, `申请被驳回：${reason}`);
      return null;
    })
  );
}

// ---------- 8. 批次召回：冻结批次 + 冻结相关申请（保留只读审计） ----------

export function recallBatch(
  dbIn: DB,
  batchId: string,
  reason: string,
  ctx: ActionContext
): TxResult & { recallId?: string; affected?: string[] } {
  const r = transaction(dbIn, (w) => {
    assert(can(ctx.role, "recall_freeze"), `越权拦截：角色 ${ctx.role} 无权执行批次召回`);
    const b = w.batches.find((x) => x.id === batchId);
    assert(b, `批次 ${batchId} 不存在`);
    assert(b.status !== "recalled", `批次 ${batchId} 已处于召回状态（重复召回无效）`);

    const recallId = nextId(
      "RCL",
      w.recalls.map((x) => x.id)
    );
    b.status = "recalled";
    b.frozenReason = reason;
    b.recallId = recallId;

    const affected: string[] = [];
    for (const o of w.orders) {
      const touches =
        o.allocations.some((a) => a.batchId === batchId) ||
        (o.items.some((i) => i.reagentId === b.reagentId) && o.status === "draft");
      if (!touches) continue;
      if (["reserved"].includes(o.status)) {
        // 释放该批次上的预留；其余批次的预留保留无意义（单据整体冻结不可再发放），一并释放
        for (const a of o.allocations) {
          const tb = w.batches.find((x) => x.id === a.batchId)!;
          tb.reservedQty = round(tb.reservedQty - a.qty);
        }
        o.allocations = [];
      }
      if (!["closed", "cancelled"].includes(o.status)) {
        o.status = "frozen";
        o.frozenReason = `关联批次 ${batchId} 召回：${reason}`;
        o.version += 1;
        log(o, "recall_freeze", ctx.actor, `因 ${recallId} 批次 ${batchId} 召回，单据冻结为只读；已释放全部预留`);
        affected.push(o.id);
      }
    }
    w.recalls.unshift({
      id: recallId,
      batchId,
      reason,
      createdAt: new Date().toISOString(),
      operator: ctx.actor,
      affectedOrders: affected,
    });
    return { recallId, affected };
  });
  const res = r.result as { recallId?: string; affected?: string[]; error?: string };
  return { db: r.db, error: res.error, recallId: res.recallId, affected: res.affected };
}

// ---------- 批次/试剂/库位维护（同样事务化，含库位相容校验） ----------

export function addBatch(
  dbIn: DB,
  input: Omit<Batch, "id" | "remainingQty" | "reservedQty" | "status">,
  ctx: ActionContext
): TxResult & { batchId?: string } {
  const r = transaction(dbIn, (w) => {
    assert(can(ctx.role, "reserve"), `越权拦截：仅库管员/管理员可登记批次`);
    const reagent = w.reagents.find((x) => x.id === input.reagentId)!;
    assert(reagent, "试剂不存在");
    const loc = w.locations.find((x) => x.id === input.locationId);
    assert(loc, "库位不存在");
    const locErr = checkLocation(w, loc, reagent);
    assert(!locErr, locErr!);
    assert(input.initialQty > 0, "初始数量必须大于 0");
    assert(input.expiresAt >= input.receivedAt, "效期不能早于入库日期");
    const id = nextId(
      "LOT",
      w.batches.map((b) => b.id)
    );
    w.batches.unshift({
      ...input,
      id,
      remainingQty: input.initialQty,
      reservedQty: 0,
      status: "active",
    });
    return { batchId: id };
  });
  const res = r.result as { batchId?: string; error?: string };
  return { db: r.db, error: res.error, batchId: res.batchId };
}

export function freezeBatch(dbIn: DB, batchId: string, reason: string, ctx: ActionContext): TxResult {
  return unwrap(
    transaction(dbIn, (w) => {
      assert(can(ctx.role, "recall_freeze"), "越权拦截：仅管理员可冻结批次");
      const b = w.batches.find((x) => x.id === batchId)!;
      assert(b, "批次不存在");
      assert(b.status === "active", "仅在库有效批次可冻结");
      b.status = "frozen";
      b.frozenReason = reason;
      return null;
    })
  );
}
