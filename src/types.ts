// 危化试剂库房 —— 领域模型

export type HazardClass = "oxidizer" | "flammable" | "acid" | "base" | "toxic";

export type ReactiveGroup = "strong_oxidizer" | "strong_acid" | "strong_base" | "heavy_metal_salt" | "inert";

export type Role = "researcher" | "keeper" | "admin";

export interface Reagent {
  id: string; // REA-xxx
  name: string;
  cas: string;
  hazard: HazardClass;
  group: ReactiveGroup;
  unit: string; // mL / g
  warnLine: number; // 剩余量预警线（每批次）
  incompatibleGroups: ReactiveGroup[]; // 除矩阵外的额外禁忌组
  notes?: string;
}

export type BatchStatus = "active" | "frozen" | "recalled" | "exhausted";

export interface Batch {
  id: string; // LOT-xxx
  reagentId: string;
  locationId: string;
  receivedAt: string; // yyyy-mm-dd
  expiresAt: string; // yyyy-mm-dd
  openedAt: string | null; // 开封日
  /** 开封后稳定天数；开封后效期 = min(原效期, openedAt + openStableDays) */
  openStableDays: number | null;
  initialQty: number;
  remainingQty: number; // 可用数量（未被预留的部分 = remainingQty - reservedQty）
  reservedQty: number; // 被进行中单据预留的数量
  status: BatchStatus;
  frozenReason?: string;
  recallId?: string;
}

export interface Location {
  id: string; // LOC-x
  name: string;
  zone: "防爆柜" | "酸柜" | "碱柜" | "毒害品柜" | "常温架";
  /** 允许存放的反应组；混存禁忌必须同时通过矩阵与库位检查 */
  groups: ReactiveGroup[];
  capacity: number; // 可存放批次上限
}

export type OrderStatus =
  | "draft" // 已申请
  | "reserved" // 已预留
  | "issued" // 已发放
  | "partial_return" // 部分归还
  | "consumed" // 已消耗
  | "closed" // 已关闭
  | "cancelled" // 已取消（终态）
  | "frozen"; // 召回冻结（终态，只读）

export type OrderAction =
  | "create"
  | "reserve"
  | "issue"
  | "return"
  | "consume"
  | "close"
  | "cancel"
  | "recall_freeze"
  | "reject";

export interface Allocation {
  batchId: string;
  qty: number;
}

export interface OrderItem {
  reagentId: string;
  qty: number;
}

export interface AuditEntry {
  at: string; // ISO
  action: OrderAction;
  actor: string;
  detail: string;
  /** 该步骤失败时记录被拦截原因 */
  rejected?: string;
}

export interface Order {
  id: string; // ORD-xxx
  applicant: string;
  items: OrderItem[];
  status: OrderStatus;
  allocations: Allocation[]; // reserve 成功后写入：FIFO 跨批次占用
  issuedQty: number; // 已发放总量
  returnedQty: number; // 部分归还总量
  consumedQty: number; // 已确认消耗总量
  createdAt: string;
  updatedAt: string;
  version: number; // 乐观锁
  idempotencyKeys: string[]; // 已处理的动作令牌（防重复提交）
  audit: AuditEntry[];
  frozenReason?: string;
}

export interface Recall {
  id: string; // RCL-xxx
  batchId: string;
  reason: string;
  createdAt: string;
  operator: string;
  affectedOrders: string[];
}

export interface DB {
  reagents: Reagent[];
  batches: Batch[];
  locations: Location[];
  orders: Order[];
  recalls: Recall[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export const HAZARD_LABEL: Record<HazardClass, string> = {
  oxidizer: "氧化剂",
  flammable: "易燃",
  acid: "腐蚀(酸)",
  base: "腐蚀(碱)",
  toxic: "毒害品",
};

export const GROUP_LABEL: Record<ReactiveGroup, string> = {
  strong_oxidizer: "强氧化剂",
  strong_acid: "强酸",
  strong_base: "强碱",
  heavy_metal_salt: "重金属盐",
  inert: "惰性",
};
