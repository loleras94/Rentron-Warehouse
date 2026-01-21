export function mapDeadLog(raw: any) {
  return {
    type: "dead",
    id: raw.id,
    operatorUsername: raw.operator_username,
    orderNumber: raw.order_number,
    productionSheetNumber: raw.production_sheet_number,
    productId: raw.product_id,
    deadCode: raw.dead_code,
    deadDescription: raw.dead_description,
    startTime: raw.start_time,
    endTime: raw.end_time,
  };
}
