import React, { useEffect, useState } from "react";
import { getLiveStatus } from "../api/client";
import { useTranslation } from "../hooks/useTranslation";

const LivePhasesView = () => {
  const { t } = useTranslation();

  const [data, setData] = useState<{
    active: any[];
    dead: any[];
    idle: any[];
  }>({
    active: [],
    dead: [],
    idle: [],
  });

  const load = async () => {
    const res = await getLiveStatus();
    setData(res);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const parsePgTimestamp = (ts: string) => {
    if (!ts) return null;
    let clean = ts.replace(" ", "T");
    if (!clean.endsWith("Z") && !clean.includes("+") && !clean.includes("-")) {
      clean += "Z";
    }
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatLocal = (ts: string) => {
    const d = parsePgTimestamp(ts);
    return d ? d.toLocaleString() : t("livePhases.invalidDate");
  };

  // helper: try multiple possible backend keys for product on "idle"
  const idleProductOf = (u: any) => {
    const direct = String(u?.lastProductId ?? "").trim();
    if (direct) return direct;

    // fallback: if lastProductId absent but we have multiItems reconstructed
    const fromItems = String(u?.multiItems?.[0]?.productId ?? "").trim();
    return fromItems ? fromItems : null;
  };


  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">{t("livePhases.title")}</h2>

      {/* ACTIVE PHASES */}
      <h3 className="text-xl font-semibold mt-4 mb-2">{t("livePhases.activeNow")}</h3>
      <div className="space-y-2">
        {data.active.map((a, i) => {
          const runningMin = Math.round(a.runningSeconds / 60);
          const plannedMin = Math.round(a.plannedTime);

          return (
            <div
              key={i}
              className={`p-3 rounded-md border ${
                a.isOverrun ? "bg-red-100 border-red-400" : "bg-green-100 border-green-400"
              }`}
            >
              <p>
                <b>{t("livePhases.user")}:</b> {a.username}
              </p>
              <p>
                <b>{t("livePhases.sheet")}:</b> {a.productionSheetNumber}
              </p>
              <p>
                <b>{t("livePhases.product")}:</b> {a.productId}
              </p>
              <p>
                <b>{t("livePhases.phase")}:</b> {a.phaseId}
              </p>
              <p>
                <b>{t("livePhases.status")}:</b> {a.status}
              </p>
              <p>
                <b>{t("livePhases.running")}:</b> {runningMin} {t("livePhases.minutes")}
              </p>

              {/* MULTI-JOB DETAILS */}
              {a.status === "multi" && Array.isArray(a.multiItems) && a.multiItems.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <p className="font-semibold">
                    {t("livePhases.multiJobs")}: {a.multiItems.length}
                  </p>

                  <ul className="list-disc ml-5">
                    {a.multiItems.map((j: any, idx: number) => (
                      <li key={idx}>
                        <span className="font-semibold">{t("livePhases.sheet")}:</span>{" "}
                        {j.productionSheetNumber ?? j.sheet ?? "—"}
                        {" • "}
                        <span className="font-semibold">{t("livePhases.product")}:</span>{" "}
                        {j.productId ?? "—"}
                        {" • "}
                        <span className="font-semibold">{t("livePhases.phase")}:</span>{" "}
                        {j.phaseId ?? "—"}
                        {j.productionPosition != null ? ` • pos: ${j.productionPosition}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {a.isOverrun && (
                <p className="text-red-700 font-bold mt-1">
                  ⚠ {t("livePhases.overrun")} ({t("livePhases.planned")}: {plannedMin}{" "}
                  {t("livePhases.minutes")} — {t("livePhases.actual")}: {runningMin}{" "}
                  {t("livePhases.minutes")})
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ACTIVE DEAD TIME */}
      <h3 className="text-xl font-semibold mt-6 mb-2">{t("livePhases.activeDeadTime")}</h3>
      <div className="space-y-2">
        {data.dead.map((d, i) => {
          const runningMin = Math.round(d.runningSeconds / 60);

          return (
            <div key={i} className="p-3 rounded-md border bg-yellow-100 border-yellow-400">
              <p>
                <b>{t("livePhases.user")}:</b> {d.username}
              </p>
              <p>
                <b>{t("livePhases.code")}:</b> {d.code} – {d.description}
              </p>

              {d.orderNumber && d.productionSheetNumber && (
                <p>
                  <b>{t("livePhases.sheet")}:</b> {d.orderNumber}/{d.productionSheetNumber}
                </p>
              )}

              {d.productId && (
                <p>
                  <b>{t("livePhases.product")}:</b> {d.productId}
                </p>
              )}

              <p>
                <b>{t("livePhases.running")}:</b> {runningMin} {t("livePhases.minutes")}
              </p>
            </div>
          );
        })}
      </div>

      {/* IDLE USERS */}
      <h3 className="text-xl font-semibold mt-6 mb-2">{t("livePhases.idleUsers")}</h3>
      <div className="space-y-2">
        {data.idle.map((u, i) => {
          const idleProduct = idleProductOf(u);

          return (
            <div key={i} className="p-3 rounded-md border bg-gray-100 border-gray-300">
              <p>
                <b>{t("livePhases.user")}:</b> {u.username}
              </p>

              {/* Last PHASE */}
              {u.kind === "phase" && (
                <>
                  <p>
                    <b>{t("livePhases.lastSheet")}:</b> {u.lastSheetNumber}
                  </p>

                  {/* NEW: show product for last phase (if provided) */}
                  <p>
                    <b>{t("livePhases.product")}:</b> {idleProduct ?? "—"}
                  </p>

                  <p>
                    <b>{t("livePhases.lastPhase")}:</b> {u.lastPhaseId}
                  </p>
                </>
              )}

              {/* Last DEAD TIME */}
              {u.kind === "dead" && (
                <>
                  <p>
                    <b>{t("livePhases.lastWorkDeadTime")}</b>
                  </p>
                  <p>
                    <b>{t("livePhases.code")}:</b> {u.deadCode} – {u.deadDescription}
                  </p>

                  {u.deadOrderNumber && u.deadProductionSheetNumber && (
                    <p>
                      <b>{t("livePhases.sheet")}:</b> {u.deadOrderNumber}/{u.deadProductionSheetNumber}
                    </p>
                  )}

                  {/* already existed; keep it */}
                  {u.deadProductId && (
                    <p>
                      <b>{t("livePhases.product")}:</b> {u.deadProductId}
                    </p>
                  )}
                </>
              )}

              {/* If backend provides multiItems for idle users (last session was multi), show them */}
              {u.kind === "phase" && Array.isArray(u.multiItems) && u.multiItems.length > 1 && (
                <div className="mt-2 border-t pt-2">
                  <p className="font-semibold">
                    {t("livePhases.multiJobs")}: {u.multiItems.length}
                  </p>

                  <ul className="list-disc ml-5">
                    {u.multiItems.map((j: any, idx: number) => (
                      <li key={idx}>
                        <span className="font-semibold">{t("livePhases.sheet")}:</span>{" "}
                        {j.productionSheetNumber ?? "—"}
                        {" • "}
                        <span className="font-semibold">{t("livePhases.product")}:</span>{" "}
                        {j.productId ?? "—"}
                        {" • "}
                        <span className="font-semibold">{t("livePhases.phase")}:</span>{" "}
                        {j.phaseId ?? "—"}
                        {j.productionPosition != null ? ` • pos: ${j.productionPosition}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* OPTIONAL: if backend sends product even when kind is unknown */}
              {u.kind !== "phase" && u.kind !== "dead" && idleProduct && (
                <p>
                  <b>{t("livePhases.product")}:</b> {idleProduct}
                </p>
              )}

              <p>
                <b>{t("livePhases.finished")}:</b> {formatLocal(u.finishedAt)}
              </p>
              <p>
                <b>{t("livePhases.idle")}:</b> {Math.round(u.idleSeconds / 60)}{" "}
                {t("livePhases.minutes")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LivePhasesView;
