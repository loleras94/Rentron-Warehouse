/* ============================================================
   HISTORY / MATERIALS
   ============================================================ */

export interface HistoryEvent {
  timestamp: string;
  type:
    | "CREATED"
    | "PLACED"
    | "MOVED"
    | "CONSUMED"
    | "PARTIALLY_CONSUMED"
    | "ADJUSTED"
    | "SYNC"        // ✅ Added for backend → frontend synchronization
    | "UPDATED";    // ✅ Added for update tracking
  details: Record<string, any>;
}

export interface MaterialLocation {
  area: string | null;     // ✅ made nullable to match backend "area" (may be null)
  position: string | null; // ✅ made nullable to match backend "position" (may be null)
}

export interface Material {
  id: string;
  materialCode: string;
  initialQuantity: number;
  currentQuantity: number;
  location: MaterialLocation | null;
  history: HistoryEvent[];
}

export interface QrData {
  id: string;
  materialCode: string;
  quantity: number;
}

/* ============================================================
   PRODUCT / ORDER / PRODUCTION SHEET / FRAMES
   ============================================================ */

export interface ProductMaterial {
  materialId: string;
  quantityPerPiece: number;
  totalQuantity?: number;
  position?: string;
}

export interface ProductPhase {
  phaseId: string;
  setupTime: number;
  productionTimePerPiece: number;
  totalSetupTime?: number; 
  totalProductionTime?: number; 
  position: string;
  productionPosition: string;
}

export interface Product {
  id: string;
  name: string;
  materials: ProductMaterial[];
  phases: ProductPhase[];
}

export interface Order {
  orderNumber: string;
  createdAt: string;
}

export interface ProductionSheet {
  id: string;
  orderNumber: string;
  productionSheetNumber: string;
  productId: string;
  quantity: number;
  qrValue: string;
}

export interface Phase {
  id: string;
  name: string;
}

export interface PhaseLog {
  id: string;
  operatorUsername: string;
  orderNumber: string;
  productionSheetNumber: string;
  productId: string;
  phaseId: string;
  position: string;
  productionPosition: string;
  startTime: string;
  endTime: string | null;
  quantityDone: number;
  totalQuantity: number;
  findMaterialTime?: number;  // in seconds
  setupTime?: number;         // 🆕 total setup duration (seconds)
  productionTime?: number;    // 🆕 total production duration (seconds)
  stage: "find" | "setup" | "production";
}

export interface ProductionSheetForOperator extends ProductionSheet {
  orderNumber: string;
  product: Product;
  phaseLogs: PhaseLog[];
}

export interface ProductForUI extends Product {
  quantity?: number; // <--- AMIBITO, only for UI calculations
}


export interface Frame {
  frameId: number;
  widthCm: number | null;
  heightCm: number | null;
  quality: FrameQuality | null;
  position: FramePosition | null;
  productIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MaterialUseLog {
  id: string;
  username: string | null;
  entry_type: "product_sheet" | "sample";
  production_sheet_number: string | null;
  source: "sheet" | "manual" | "remnant";
  material_code: string | null;
  quantity: number | null;
  unit: MaterialUseUnit | null;
  created_at: string;
}

/* ============================================================
   USERS / AUTH
   ============================================================ */

export type UserRole =
  | "manager"
  | "operator"
  | "orderkeeper"
  | "machineoperator"
  | "infraoperator"
  | "storekeeper"
  | "framekeeper"
  | "materiallogger"
  | "warehousemanager";

export type AllowedView =
  | "operator"
  | "search"
  | "manager"
  | "batch-create"
  | "transactions"
  | "orders"
  | "scan-product-sheet"
  | "daily-logs"
  | "phase-manager"
  | "history"
  | "pdf-import"
  | "live-phases"
  | "account"
  | "dead-time"
  | "frames"
  | "material-use"
  | "multi-jobs";

export interface User {
  id: number;
  username: string;
  roles: UserRole[];           // ✅ Array of roles (frontend format)
  allowedTabs: AllowedView[];
  createdAt: string;
  lastLogin: string | null;
  passwordHash?: string;
}

export interface FrameQrData {
  type: "FRAME";
  frameId: number;
}


/* ============================================================
   OTHER TYPES
   ============================================================ */

export type View = AllowedView;

export type ActionType =
  | "CONSUMPTION"
  | "PLACEMENT"
  | "MOVEMENT"
  | "PARTIAL_CONSUMPTION";

export type Language = "en" | "el" | "ar";

export type FramePosition = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17;
export type FrameQuality = 90 | 120;

export type MaterialUseUnit = "KG" | "m" | "cm" | "pcs" | "other";

//export type ParsedMaterial = { code: string; sheetCount: number };

/* ============================================================
   TRANSACTIONS (DB format)
   ============================================================ */

export type Transaction = {
  id: string;
  materialId: string;
  materialName: string;
  quantityChange: number;
  fromQty?: number | null;
  toQty?: number | null;
  reason?: string | null;
  user?: string | null;
  location?: { area: string; position: string } | null;
  timestamp: string;
};

