// src/mapPhaseLog.ts
import type { PhaseLog } from "../src/types";

export function mapPhaseLog(raw: any): PhaseLog {
  if (!raw) throw new Error("Empty PhaseLog row received from server");

  return {
    id: raw.id,
    operatorUsername: raw.operator_username,
    orderNumber: raw.order_number,
    productionSheetNumber: raw.production_sheet_number,
    productId: raw.product_id,
    phaseId: String(raw.phase_id),
    position: raw.position,
    productionPosition: raw.production_position,
    startTime: raw.start_time,
    endTime: raw.end_time,
    quantityDone: raw.quantity_done,
    totalQuantity: raw.total_quantity,
    findMaterialTime: raw.find_material_time,
    setupTime: raw.setup_time,
    productionTime: raw.production_time,
    stage: raw.stage,
  };
}
