// 浏览器端到端验证（真实页面 + localStorage 持久化）
import { chromium } from "playwright";

const BASE = "http://localhost:62003";
const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + String(extra).slice(0, 180) : ""}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("hazchem-store-v1"));
await page.reload({ waitUntil: "networkidle" });

const $ = (sel) => page.locator(sel);

async function shot(name) {
  await page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
}
/** 执行动作并断言“该动作之后新出现”的 toast（给旧 toast 打标记，避免与自动消失竞态） */
async function act(action, kind, contains, label) {
  await page.$$eval(".toast", (els) => els.forEach((e) => e.setAttribute("data-seen", "1")));
  await action();
  try {
    await page.waitForFunction(() => !!document.querySelector(".toast:not([data-seen])"), { timeout: 4000 });
  } catch {
    check(label, false, "未出现新 toast");
    return;
  }
  const last = page.locator(".toast:not([data-seen])").last();
  const cls = await last.getAttribute("class");
  const text = (await last.textContent()) ?? "";
  check(label, cls.includes(kind) && text.includes(contains), text);
}
async function setRole(role) {
  await $('[data-testid="role-select"]').selectOption(role);
}
async function resetData() {
  await $('[data-testid="reset-data"]').click();
  await page.waitForTimeout(350);
}
async function waitFor(fn, label) {
  try { await page.waitForFunction(fn, { timeout: 4000 }); }
  catch { check(label, false, "条件未满足"); }
}

// ================= 场景 1：FIFO 跨批次分配 =================
console.log("\n=== 场景 1：FIFO 跨批次分配（乙醇 400mL = LOT-001×300 + LOT-002×100）===");
{
  await $('[data-testid="tab-orders"]').click();
  const preview = await $('[data-testid="fifo-1"]').textContent();
  check("FIFO 预览 LOT-001×300 → LOT-002×100",
    preview.includes("LOT-001×300") && preview.includes("LOT-002×100"), preview);
  await act(() => $('[data-testid="submit-atomic"]').click(), "ok", "申请+预留原子完成", "申请并预留成功");
  const card = await $('[data-testid="order-ORD-001"]').textContent();
  check("单据出现 LOT-001 × 300 与 LOT-002 × 100 占用徽标",
    card.includes("LOT-001 × 300") && card.includes("LOT-002 × 100"));
  await shot("01-fifo-cross-batch");
}

// ================= 场景 2：效期边界 =================
console.log("\n=== 场景 2：效期边界（今日到期可发 / 过期批次拦截）===");
{
  await resetData();
  await $('[data-testid="tab-inventory"]').click();
  const lot010 = await $('[data-testid="batch-row-LOT-010"]').textContent();
  check("LOT-010 标注今日到期", lot010.includes("今日到期"), lot010.match(/今日到期|临期|天后到期/)?.[0]);
  const lot012 = await $('[data-testid="batch-row-LOT-012"]').textContent();
  check("LOT-012 标注已过期", lot012.includes("已过期"), lot012.match(/已过期\s*\d+\s*天/)?.[0]);
  await shot("02a-expiry-inventory");

  // 研究员申请高锰酸钾 200 → FIFO 应给今日到期的 LOT-010，过期 LOT-012 列入拦截
  await $('[data-testid="tab-orders"]').click();
  await page.selectOption(".line-box select", "REA-001");
  await page.fill(".line-box input[type=number]", "200");
  const pv = await $('[data-testid="fifo-1"]').textContent();
  check("今日到期批次优先 FIFO 分配 LOT-010×200", pv.includes("LOT-010×200"), pv);
  check("过期批次 LOT-012 在拦截列表", pv.includes("LOT-012") && pv.includes("过期"), pv);
  await act(() => $('[data-testid="submit-draft"]').click(), "ok", "已创建", "高锰酸钾申请单创建");
  check("研究员视角无预留/发放按钮（越权不可见）",
    (await page.locator('[data-testid^="btn-reserve-"]').count()) === 0 &&
    (await page.locator('[data-testid^="btn-issue-"]').count()) === 0);

  // 切库管员：预留 → 到期当日发放成功
  await setRole("keeper");
  await act(() => $('[data-testid="btn-reserve-ORD-001"]').click(), "ok", "预留成功", "库管员预留（今日到期批次被占用）");
  await act(() => $('[data-testid="btn-issue-ORD-001"]').click(), "ok", "已发放出库", "到期当日发放成功（边界内）");
  const issued = await $('[data-testid="order-ORD-001"]').textContent();
  check("单据已发放，LOT-010 用尽", issued.includes("已发放"));
  await $('[data-testid="tab-inventory"]').click();
  const lot010b = await $('[data-testid="batch-row-LOT-010"]').textContent();
  check("LOT-010 剩余归零标为用尽", lot010b.includes("用尽"));
  await shot("02b-issued-on-expiry-day");
}

// ================= 场景 3：并发冲突 =================
console.log("\n=== 场景 3：并发领用冲突（无负库存）===");
{
  await resetData();
  await $('[data-testid="tab-orders"]').click();
  await act(() => $('[data-testid="sim-80-2"]').click(), "err", "缺口 60", "2×80 中后到请求被拒（缺口 60）");
  const log = await $('[data-testid="sim-log"]').textContent();
  check("并发日志：请求1成功、请求2拒绝、1/2 总结",
    /请求1\(张三\) 成功/.test(log) && /请求2\(李四\) 被拒绝/.test(log) && log.includes("1/2 成功"),
    log.replace(/\s+/g, " ").slice(0, 220));
  await $('[data-testid="tab-inventory"]').click();
  const row = await $('[data-testid="batch-row-LOT-020"]').textContent();
  check("LOT-020 剩余 100、预留 80（绝无负值）",
    /(^|\D)100\s*mL/.test(row) && row.includes("80 预留"), row.replace(/\s+/g, " ").slice(0, 160));
  await shot("03-concurrent-conflict");

  await resetData();
  await $('[data-testid="tab-orders"]').click();
  await act(() => $('[data-testid="sim-40-3"]').click(), "err", "缺口 20", "3×40 中第三个请求被拒（缺口 20）");
  const log2 = await $('[data-testid="sim-log"]').textContent();
  check("3×40：2/3 成功", log2.includes("2/3 成功") && /请求1.*成功/.test(log2) && /请求2.*成功/.test(log2),
    log2.replace(/\s+/g, " ").slice(0, 200));
}

// ================= 场景 4：回滚 / 重复提交 / 越权 =================
console.log("\n=== 场景 4：回滚 / 重复提交 / 越权 ===");
{
  await resetData();
  await setRole("researcher");
  await $('[data-testid="tab-orders"]').click();

  // 4a. 相容性拦截（内联提示 + 点击后事务层拦截，两种提交路径都不留痕）
  await page.locator("button", { hasText: "+ 添加试剂行" }).click();
  const boxes = page.locator(".line-box");
  await boxes.nth(0).locator("select").selectOption("REA-002"); // 浓硫酸
  await boxes.nth(1).locator("select").selectOption("REA-001"); // 高锰酸钾
  const formText = await page.locator(".side-form").textContent();
  check("侧栏内联显示相容性拦截提示", formText.includes("不相容，申请将被拦截"));
  await act(() => $('[data-testid="submit-draft"]').click(), "err", "相容性拦截", "待预留路径：强酸+氧化剂被拦截");
  check("拦截不留痕：无单据生成", (await page.locator('[data-testid^="order-ORD-"]').count()) === 0);
  await act(() => $('[data-testid="submit-atomic"]').click(), "err", "相容性拦截", "原子路径：强酸+氧化剂同样被拦截");
  check("仍无单据生成", (await page.locator('[data-testid^="order-ORD-"]').count()) === 0);
  await shot("04a-incompatible-blocked");

  // 4b. 原子单多试剂中一种库存不足 → 整单回滚不留痕
  await boxes.nth(0).locator("select").selectOption("REA-005"); // 乙醇
  await boxes.nth(0).locator("input[type=number]").fill("50");
  await boxes.nth(1).locator("select").selectOption("REA-006"); // 丙酮
  await boxes.nth(1).locator("input[type=number]").fill("999");
  check("相容组合按钮恢复可用", await $('[data-testid="submit-atomic"]').isEnabled());
  await act(() => $('[data-testid="submit-atomic"]').click(), "err", "整单回滚", "库存不足原子单整单回滚");
  check("回滚后单据数为 0", (await page.locator('[data-testid^="order-ORD-"]').count()) === 0);

  // 4c. 两步流程 + 重复提交幂等
  await page.locator("button", { hasText: "删" }).nth(1).click();
  await boxes.nth(0).locator("select").selectOption("REA-006");
  await boxes.nth(0).locator("input[type=number]").fill("60");
  await act(() => $('[data-testid="submit-draft"]').click(), "ok", "已创建", "丙酮草稿单创建");
  await setRole("keeper");
  // 双击重复提交：连压按钮一次点击内同步发出两个相同幂等键请求，第二次必须被拦截
  await page.$$eval(".toast", (els) => els.forEach((e) => e.setAttribute("data-seen", "1")));
  await $('[data-testid="btn-replay-ORD-001"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".toast:not([data-seen])").length >= 2, { timeout: 4000 });
  const dupTexts = await page.locator(".toast:not([data-seen])").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  check("重复提交：首次预留成功", dupTexts.some((t) => t.includes("预留成功")), dupTexts.join(" || "));
  check("重复提交：第二次同键被拦截", dupTexts.some((t) => t.includes("重复提交拦截")), dupTexts.join(" || "));
  // 单据只预留一次（v 只增加 1 次预留）
  const card1 = await $('[data-testid="order-ORD-001"]').textContent();
  check("重复请求后单据仍只预留一次（正常已预留状态）", card1.includes("已预留"), card1.match(/待预留|已预留/)?.[0]);
  await shot("04b-idempotent-replay");

  // 4d. 取消 reserved 单 → 预留全部释放
  await act(() => $('[data-testid="btn-cancel-ORD-001"]').click(), "ok", "预留全部释放", "取消单据并释放预留");
  await $('[data-testid="tab-inventory"]').click();
  const row = await $('[data-testid="batch-row-LOT-020"]').textContent();
  check("取消后 LOT-020 无预留占用", !row.includes("预留"), row.replace(/\s+/g, " ").slice(0, 120));
  await shot("04c-cancel-release");
}

// ================= 场景 5：召回冻结 / 只读审计 / 刷新恢复 =================
console.log("\n=== 场景 5：召回冻结 / 只读审计 / 刷新持久化 ===");
{
  await resetData();
  await setRole("researcher");
  await $('[data-testid="tab-orders"]').click();
  await page.locator(".line-box select").selectOption("REA-004"); // 硝酸银
  await page.fill(".line-box input[type=number]", "30");
  await act(() => $('[data-testid="submit-atomic"]').click(), "ok", "跨批次占用", "硝酸银原子预留（LOT-030×30）");
  const card = await $('[data-testid="order-ORD-001"]').textContent();
  check("占用 LOT-030 × 30", card.includes("LOT-030 × 30"));

  await setRole("admin");
  await $('[data-testid="tab-inventory"]').click();
  await $('[data-testid="recall-btn-LOT-030"]').click();
  await $('[data-testid="recall-dialog"]').waitFor();
  await shot("05a-recall-dialog");
  await act(() => $('[data-testid="confirm-recall"]').click(), "ok", "冻结单据 ORD-001", "召回冻结相关申请单");
  const lot = await $('[data-testid="batch-row-LOT-030"]').textContent();
  check("LOT-030 变为召回", lot.includes("召回"));
  check("LOT-030 预留已释放（无 30 预留）", !lot.includes("30 预留"), lot.replace(/\s+/g, " ").slice(0, 140));
  await shot("05b-after-recall");

  await $('[data-testid="tab-orders"]').click();
  const frozenCard = await $('[data-testid="order-ORD-001"]').textContent();
  check("单据召回冻结 + 只读终态提示",
    frozenCard.includes("召回冻结") && frozenCard.includes("只读终态"),
    frozenCard.replace(/\s+/g, " ").slice(0, 180));
  check("冻结单据无任何写操作按钮",
    (await page.locator('[data-testid="order-ORD-001"] button').count()) === 0);

  await $('[data-testid="tab-audit"]').click();
  await $('[data-testid="audit-pick"]').selectOption("ORD-001");
  const dossier = await $('[data-testid="dossier"]').textContent();
  check("档案保留召回冻结 + 申请即预留审计轨迹",
    dossier.includes("召回冻结") && dossier.includes("申请即预留"),
    dossier.replace(/\s+/g, " ").slice(0, 240));
  check("召回令卡片存在", (await $('[data-testid^="recall-RCL-"]').count()) >= 1);
  await shot("05c-readonly-audit");

  // 刷新后数据恢复
  await page.reload({ waitUntil: "networkidle" });
  await $('[data-testid="tab-orders"]').click();
  const fc2 = await $('[data-testid="order-ORD-001"]').textContent();
  check("刷新后单据仍为召回冻结", fc2.includes("召回冻结"));
  await $('[data-testid="tab-inventory"]').click();
  const after = await $('[data-testid="batch-row-LOT-030"]').textContent();
  check("刷新后 LOT-030 仍为召回（localStorage 恢复）", after.includes("召回"));
  await shot("05d-after-refresh");
}

// ================= 库位视图 + 看板 =================
{
  await $('[data-testid="tab-locations"]').click();
  const loc = await $('[data-testid="loc-LOC-1"]').textContent();
  check("库位视图展示防爆柜与乙醇/丙酮批次",
    loc.includes("防爆柜A") && loc.includes("无水乙醇") && loc.includes("丙酮"), loc.slice(0, 120));
  await shot("06-location-view");
  await $('[data-testid="tab-dashboard"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".metric").length === 6, { timeout: 4000 });
  const dtext = await page.locator(".view").textContent();
  check("效期风险看板渲染",
    dtext.includes("效期风险看板") && dtext.includes("按到期紧迫度排序"), "");
  await shot("07-dashboard");
}

check("全程无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));

const failed = results.filter((r) => !r.ok);
console.log(`\n浏览器验证：${results.length - failed.length}/${results.length} 通过`);
await browser.close();
if (failed.length) {
  console.log("失败项：\n - " + failed.map((f) => f.name).join("\n - "));
  process.exit(1);
}
