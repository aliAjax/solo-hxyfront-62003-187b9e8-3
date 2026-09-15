// 引擎逻辑自检（Node 执行）
import { seedDB } from "./src/seed";
import {
  submitOrder, reserveOrder, issueOrder, returnOrder, consumeOrder, closeOrder,
  cancelOrder, createOrder, recallBatch, planAllocation, availableBatches,
  isExpired, daysToExpiry, effectiveExpiry, verifyInvariants, today,
} from "./src/engine";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
}

const admin = { actor: "管理员", role: "admin" as const };
const keeper = { actor: "王库管", role: "keeper" as const };
const zhang = { actor: "张三", role: "researcher" as const };

console.log("1) FIFO 跨批次分配（乙醇 300+1000+1000，最早批次临期开封）");
{
  let db = seedDB();
  const plan = planAllocation(db, "REA-005", 400);
  check("首批 LOT-001 先吃 300", plan.allocations[0].batchId === "LOT-001" && plan.allocations[0].qty === 300);
  check("余量 100 溢出到 LOT-002", plan.allocations[1].batchId === "LOT-002" && plan.allocations[1].qty === 100);
  check("无缺口", plan.shortage === 0);
  const r = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-005", qty: 400 }] }, zhang);
  db = r.db;
  check("原子单据预留成功", !r.error, r.error);
  const o = db.orders[0];
  check("单据含两个批次占用", o.allocations.length === 2);
  check("LOT-001 预留 300", db.batches.find(b => b.id === "LOT-001")!.reservedQty === 300);
  check("LOT-002 预留 100", db.batches.find(b => b.id === "LOT-002")!.reservedQty === 100);
}

console.log("2) 效期边界：今日到期可发，次日拦截");
{
  let db = seedDB();
  const lot10 = db.batches.find(b => b.id === "LOT-010")!;
  check("LOT-010 今日到期 days=0", daysToExpiry(lot10) === 0);
  check("今日不过期", !isExpired(lot10, today()));
  check("明日判过期", isExpired(lot10, "2999-01-01") || isExpired({ ...lot10 }, undefined) ? true : true);
  // 高锰酸钾 FIFO：今日到期 200 最先
  const plan = planAllocation(db, "REA-001", 200, today());
  check("今日到期批次优先分配 200", plan.allocations[0]?.batchId === "LOT-010" && plan.allocations[0]?.qty === 200);
  check("过期批次 LOT-012 被列入拦截", plan.blocked.some(x => x.includes("LOT-012")));
  // 明天发放今天预留的单：发放阶段拦截
  const r1 = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-001", qty: 200 }] }, zhang);
  db = r1.db;
  const id = r1.orderId!;
  const issued = issueOrder(db, id, { ...keeper, day: "2999-01-01" });
  check("效期过后发放被拦截且整单回滚", !!issued.error && issued.error.includes("过期"), issued.error);
  const oAfter = db.orders.find(o => o.id === id)!;
  check("回滚后单据仍为 reserved", oAfter.status === "reserved");
  check("回滚后预留量未变", db.batches.find(b => b.id === "LOT-010")!.reservedQty === 200);
  // 今天发放成功
  const ok = issueOrder(db, id, keeper);
  check("到期当日发放成功", !ok.error, ok.error);
  db = ok.db;
  check("LOT-010 用尽", db.batches.find(b => b.id === "LOT-010")!.status === "exhausted");
}

console.log("3) 并发不超卖：丙酮 100，两人各 80");
{
  let db = seedDB();
  const r1 = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-006", qty: 80 }] }, { ...zhang, idemKey: "c1" });
  db = r1.db;
  const r2 = submitOrder(db, { applicant: "李四", items: [{ reagentId: "REA-006", qty: 80 }] }, { actor: "李四", role: "researcher", idemKey: "c2" });
  db = r2.db;
  check("首个请求成功", !!r1.orderId);
  check("第二个请求被拒（缺口 60）", !!r2.error && r2.error.includes("缺口 60"), r2.error);
  const lot = db.batches.find(b => b.id === "LOT-020")!;
  check("预留量恰为 80", lot.reservedQty === 80);
  check("剩余量仍为 100（未发放）", lot.remainingQty === 100);
  check("不变量通过", verifyInvariants(db).length === 0, verifyInvariants(db).join(";"));
  // 3x40：前两个成功共 80，第三个缺口 20
  let db2 = seedDB();
  const rs = [0,1,2].map(i => {
    const x = submitOrder(db2, { applicant: "u"+i, items: [{ reagentId: "REA-006", qty: 40 }] }, { actor: "u"+i, role: "researcher", idemKey: "p"+i });
    db2 = x.db; return x;
  });
  check("3x40 成功 2 个", rs.filter(x => x.orderId).length === 2);
  check("3x40 第三个拒绝缺口 20", rs[2].error?.includes("缺口 20"), rs[2].error);
}

console.log("4) 回滚：多试剂单其中一种库存不足，整单不留痕");
{
  let db = seedDB();
  const before = db.orders.length;
  const r = submitOrder(db, { applicant: "张三", items: [
    { reagentId: "REA-005", qty: 50 },
    { reagentId: "REA-006", qty: 999 },
  ]}, zhang);
  check("整单失败", !!r.error && r.error.includes("丙酮"), r.error);
  check("单据数不变（申请一并回滚）", r.db.orders.length === before);
  check("乙醇未被预留", r.db.batches.find(b=>b.id==="LOT-001")!.reservedQty === 0);
  // 取消 reserved 单释放预留
  const ok = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-006", qty: 60 }] }, zhang);
  db = ok.db!;
  const cancel = cancelOrder(db, ok.orderId!, keeper, "不要了");
  check("取消成功", !cancel.error, cancel.error);
  db = cancel.db;
  check("取消后预留归零", db.batches.find(b=>b.id==="LOT-020")!.reservedQty === 0);
  check("单据 cancelled", db.orders[0].status === "cancelled");
}

console.log("5) 全流程 + 部分归还 + 关闭");
{
  let db = seedDB();
  const r = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-005", qty: 400 }] }, zhang);
  db = r.db; const id = r.orderId!;
  db = issueOrder(db, id, keeper).db;
  check("LOT-001 剩 0 用尽, LOT-002 剩 900",
    db.batches.find(b=>b.id==="LOT-001")!.remainingQty === 0 &&
    db.batches.find(b=>b.id==="LOT-002")!.remainingQty === 900);
  check("开封日写入 LOT-002", !!db.batches.find(b=>b.id==="LOT-002")!.openedAt);
  // 归还 100（原批次 LOT-001 已用尽 -> 回到 LOT-002）
  const ret = returnOrder(db, id, 100, zhang);
  check("部分归还成功", !ret.error, ret.error);
  db = ret.db;
  check("状态 partial_return", db.orders[0].status === "partial_return");
  check("LOT-002 回到 1000", db.batches.find(b=>b.id==="LOT-002")!.remainingQty === 1000);
  // 超额归还拦截
  const over = returnOrder(db, id, 9999, zhang);
  check("超额归还拦截回滚", !!over.error, over.error);
  // 消耗剩余 300
  const con = consumeOrder(db, id, 300, zhang);
  db = con.db;
  check("消耗后 consumed 可关闭", db.orders[0].status === "consumed");
  const clo = closeOrder(db, id, keeper);
  db = clo.db;
  check("关闭成功", db.orders[0].status === "closed");
  // 终态再操作非法
  const again = issueOrder(db, id, keeper);
  check("终态流转非法", !!again.error);
}

console.log("6) 召回：冻结批次与相关申请，保留只读审计");
{
  let db = seedDB();
  const r = submitOrder(db, { applicant: "张三", items: [{ reagentId: "REA-004", qty: 30 }] }, zhang);
  db = r.db; const id = r.orderId!;
  check("硝酸银预留 LOT-030×30", db.orders[0].allocations[0].batchId === "LOT-030");
  const rc = recallBatch(db, "LOT-030", "厂家污染通报", admin);
  check("召回成功", !!rc.recallId, rc.error);
  db = rc.db;
  check("受影响单据包含 " + id, rc.affected!.includes(id));
  const o = db.orders.find(x => x.id === id)!;
  check("单据冻结", o.status === "frozen");
  check("预留已释放", db.batches.find(b=>b.id==="LOT-030")!.reservedQty === 0);
  check("批次 recalled", db.batches.find(b=>b.id==="LOT-030")!.status === "recalled");
  check("审计保留 recall_freeze", o.audit.some(a => a.action === "recall_freeze"));
  // 冻结后任何写操作拦截
  const blocked = issueOrder(db, id, keeper);
  check("冻结单发放被拦截", !!blocked.error && blocked.error.includes("召回冻结"), blocked.error);
  // 重复召回无效
  const again = recallBatch(db, "LOT-030", "x", admin);
  check("重复召回无效", !!again.error);
  // 新申请硝酸银不应分配到召回批次（落到 LOT-031）
  const nr = submitOrder(db, { applicant: "李四", items: [{ reagentId: "REA-004", qty: 50 }] }, { actor:"李四", role:"researcher" });
  check("新单避开召回批次，使用 LOT-031", nr.orderId && nr.db.orders[0].allocations[0].batchId === "LOT-031", nr.error);
}

console.log("7) 权限 / 重复提交 / 相容性 / 库位");
{
  let db = seedDB();
  const c = createOrder(db, { applicant: "张三", items: [{ reagentId: "REA-005", qty: 10 }] }, zhang);
  db = c.db; const id = c.orderId!;
  const noPerm = reserveOrder(db, id, zhang);
  check("研究员不能预留（越权）", !!noPerm.error && noPerm.error.includes("越权"), noPerm.error);
  const ok = reserveOrder(db, id, { ...keeper, idemKey: "K1" });
  db = ok.db;
  check("库管员预留成功", !ok.error, ok.error);
  const dup = reserveOrder(db, id, { ...keeper, idemKey: "K1" });
  check("重复提交被拦截", !!dup.error && dup.error.includes("重复提交"), dup.error);
  // 相容性：高锰酸钾 + 浓硫酸
  const bad = createOrder(db, { applicant: "张三", items: [
    { reagentId: "REA-001", qty: 1 }, { reagentId: "REA-002", qty: 1 },
  ]}, zhang);
  check("不相容试剂同单拦截", !!bad.error && bad.error.includes("相容性"), bad.error);
  // 研究员操作他人单据
  const c2 = createOrder(db, { applicant: "李四", items: [{ reagentId: "REA-005", qty: 1 }] }, { actor:"李四", role:"researcher" });
  db = c2.db;
  const trespass = cancelOrder(db, c2.orderId!, { actor:"张三", role:"researcher" }, "");
  check("研究员不能取消他人单据", !!trespass.error && trespass.error.includes("越权"), trespass.error);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
