// 演示种子数据：日期相对今天生成，保证效期/开封边界场景可复现
import { addDays, today } from "./engine";
import type { DB } from "./types";

export const STORAGE_KEY = "hazchem-store-v1";

export function seedDB(): DB {
  const T = today();
  return {
    reagents: [
      {
        id: "REA-001",
        name: "高锰酸钾",
        cas: "7722-64-7",
        hazard: "oxidizer",
        group: "strong_oxidizer",
        unit: "g",
        warnLine: 100,
        incompatibleGroups: [],
        notes: "强氧化剂，禁与酸、重金属盐混存",
      },
      {
        id: "REA-002",
        name: "浓硫酸",
        cas: "7664-93-9",
        hazard: "acid",
        group: "strong_acid",
        unit: "mL",
        warnLine: 120,
        incompatibleGroups: [],
        notes: "强酸，禁与氧化剂/碱混存",
      },
      {
        id: "REA-003",
        name: "氢氧化钠",
        cas: "1310-73-2",
        hazard: "base",
        group: "strong_base",
        unit: "g",
        warnLine: 100,
        incompatibleGroups: [],
        notes: "强碱，防潮",
      },
      {
        id: "REA-004",
        name: "硝酸银",
        cas: "7761-88-8",
        hazard: "toxic",
        group: "heavy_metal_salt",
        unit: "g",
        warnLine: 25,
        incompatibleGroups: [],
        notes: "毒害品/重金属盐，棕色瓶避光",
      },
      {
        id: "REA-005",
        name: "无水乙醇",
        cas: "64-17-5",
        hazard: "flammable",
        group: "inert",
        unit: "mL",
        warnLine: 250,
        incompatibleGroups: [],
        notes: "易燃，防爆柜存放",
      },
      {
        id: "REA-006",
        name: "丙酮",
        cas: "67-64-1",
        hazard: "flammable",
        group: "inert",
        unit: "mL",
        warnLine: 200,
        incompatibleGroups: [],
        notes: "易燃，防爆柜存放",
      },
    ],
    locations: [
      { id: "LOC-1", name: "防爆柜A", zone: "防爆柜", groups: ["inert"], capacity: 6 },
      { id: "LOC-2", name: "酸柜", zone: "酸柜", groups: ["strong_acid"], capacity: 4 },
      { id: "LOC-3", name: "碱柜", zone: "碱柜", groups: ["strong_base"], capacity: 4 },
      { id: "LOC-4", name: "毒害品柜", zone: "毒害品柜", groups: ["heavy_metal_salt"], capacity: 4 },
      { id: "LOC-5", name: "氧化剂柜", zone: "常温架", groups: ["strong_oxidizer"], capacity: 4 },
    ],
    batches: [
      // —— 无水乙醇：三批次，首批临期且已开封，用于 FIFO 跨批次分配 ——
      {
        id: "LOT-001",
        reagentId: "REA-005",
        locationId: "LOC-1",
        receivedAt: addDays(T, -120),
        expiresAt: addDays(T, 5),
        openedAt: addDays(T, -30),
        openStableDays: 60,
        initialQty: 500,
        remainingQty: 300,
        reservedQty: 0,
        status: "active",
      },
      {
        id: "LOT-002",
        reagentId: "REA-005",
        locationId: "LOC-1",
        receivedAt: addDays(T, -60),
        expiresAt: addDays(T, 400),
        openedAt: null,
        openStableDays: 90,
        initialQty: 1000,
        remainingQty: 1000,
        reservedQty: 0,
        status: "active",
      },
      {
        id: "LOT-003",
        reagentId: "REA-005",
        locationId: "LOC-1",
        receivedAt: addDays(T, -20),
        expiresAt: addDays(T, 720),
        openedAt: null,
        openStableDays: 90,
        initialQty: 1000,
        remainingQty: 1000,
        reservedQty: 0,
        status: "active",
      },
      // —— 丙酮：单批小库存，用于并发超卖冲突 ——
      {
        id: "LOT-020",
        reagentId: "REA-006",
        locationId: "LOC-1",
        receivedAt: addDays(T, -40),
        expiresAt: addDays(T, 300),
        openedAt: null,
        openStableDays: 90,
        initialQty: 100,
        remainingQty: 100,
        reservedQty: 0,
        status: "active",
      },
      // —— 高锰酸钾：今日到期（边界，当日可发）/ 正常 / 已过期（拦截） ——
      {
        id: "LOT-010",
        reagentId: "REA-001",
        locationId: "LOC-5",
        receivedAt: addDays(T, -300),
        expiresAt: T,
        openedAt: null,
        openStableDays: 30,
        initialQty: 200,
        remainingQty: 200,
        reservedQty: 0,
        status: "active",
      },
      {
        id: "LOT-011",
        reagentId: "REA-001",
        locationId: "LOC-5",
        receivedAt: addDays(T, -50),
        expiresAt: addDays(T, 200),
        openedAt: null,
        openStableDays: 30,
        initialQty: 500,
        remainingQty: 500,
        reservedQty: 0,
        status: "active",
      },
      {
        id: "LOT-012",
        reagentId: "REA-001",
        locationId: "LOC-5",
        receivedAt: addDays(T, -400),
        expiresAt: addDays(T, -2),
        openedAt: addDays(T, -100),
        openStableDays: 30,
        initialQty: 500,
        remainingQty: 150,
        reservedQty: 0,
        status: "active",
      },
      // —— 浓硫酸 ——
      {
        id: "LOT-040",
        reagentId: "REA-002",
        locationId: "LOC-2",
        receivedAt: addDays(T, -80),
        expiresAt: addDays(T, 900),
        openedAt: addDays(T, -10),
        openStableDays: 365,
        initialQty: 500,
        remainingQty: 420,
        reservedQty: 0,
        status: "active",
      },
      // —— 氢氧化钠（库存低于预警线） ——
      {
        id: "LOT-050",
        reagentId: "REA-003",
        locationId: "LOC-3",
        receivedAt: addDays(T, -200),
        expiresAt: addDays(T, 500),
        openedAt: addDays(T, -90),
        openStableDays: 180,
        initialQty: 500,
        remainingQty: 80,
        reservedQty: 0,
        status: "active",
      },
      // —— 硝酸银：召回演示目标 ——
      {
        id: "LOT-030",
        reagentId: "REA-004",
        locationId: "LOC-4",
        receivedAt: addDays(T, -70),
        expiresAt: addDays(T, 600),
        openedAt: null,
        openStableDays: 60,
        initialQty: 50,
        remainingQty: 50,
        reservedQty: 0,
        status: "active",
      },
      {
        id: "LOT-031",
        reagentId: "REA-004",
        locationId: "LOC-4",
        receivedAt: addDays(T, -15),
        expiresAt: addDays(T, 700),
        openedAt: null,
        openStableDays: 60,
        initialQty: 100,
        remainingQty: 100,
        reservedQty: 0,
        status: "active",
      },
    ],
    orders: [],
    recalls: [],
  };
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    // 损坏数据回退到种子
  }
  const db = seedDB();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  return db;
}

export function saveDB(db: DB) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
