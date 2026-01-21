import { mapPhaseLog } from "./mapPhaseLog";
import { mapDeadLog } from "./mapDeadLog";

export function mapDailyLog(raw: any) {
  if (raw.type === "phase") {
    const mapped = mapPhaseLog(raw);
    return { type: "phase", ...mapped };
  }

  if (raw.type === "dead") {
    return mapDeadLog(raw);
  }

  console.warn("Unknown log type:", raw);
  return raw;
}
