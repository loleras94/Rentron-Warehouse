import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import Scanner from "./Scanner";

type DeadCode = {
  code: number;
  requiresProductManual?: boolean; // 60
  requiresProductOrSheet?: boolean; // 70,100,130,140,150
};

const DEAD_CODES: DeadCode[] = [
  { code: 10 },
  { code: 20 },
  { code: 30 },
  { code: 40 },
  { code: 50 },
  { code: 60, requiresProductManual: true },
  { code: 70, requiresProductOrSheet: true },
  { code: 80 },
  { code: 90 },
  { code: 100, requiresProductOrSheet: true },
  { code: 110 },
  { code: 120 },
  { code: 130, requiresProductOrSheet: true },
  { code: 140, requiresProductOrSheet: true },
  { code: 150, requiresProductOrSheet: true },
  { code: 160 },
  { code: 170 },
  { code: 180 },
];

interface ActiveDeadTime {
  id: string;
  code: number;
  description: string;
  productId?: string;
  sheetId?: string;
  orderNumber?: string;
  productionSheetNumber?: string;
  runningSeconds: number;
}

interface ActivePhase {
  username: string;
  sheetId: string;
  productionSheetNumber: string;
  productId: string;
  phaseId: string;
  runningSeconds: number;
}

const DeadTimeView: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [selectedCode, setSelectedCode] = useState<number | null>(null);
  const [manualProductId, setManualProductId] = useState("");
  const [useScanner, setUseScanner] = useState(false);

  const [scannedSheetId, setScannedSheetId] = useState<string | null>(null);
  const [scannedOrderNumber, setScannedOrderNumber] = useState<string | null>(
    null
  );
  const [scannedSheetNumber, setScannedSheetNumber] = useState<string | null>(
    null
  );
  const [scannedProductId, setScannedProductId] = useState<string | null>(null);

  const [activeDead, setActiveDead] = useState<ActiveDeadTime | null>(null);
  const [activePhase, setActivePhase] = useState<ActivePhase | null>(null);

  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  // helper: format mm:ss
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // restart timer whenever activeDead changes
  useEffect(() => {
    if (!activeDead) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setSeconds(0);
      return;
    }

    setSeconds(activeDead.runningSeconds || 0);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeDead]);

  // initial load: check if user has active dead-time OR active phase-time
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const status = await api.getLiveStatus();

        const myDead = (status.dead || []).find(
          (d: any) => d.username === user.username
        );
        if (myDead) {
          setActiveDead({
            id: myDead.id,
            code: myDead.code,
            description: myDead.description,
            productId: myDead.productId,
            sheetId: myDead.sheetId,
            orderNumber: myDead.orderNumber,
            productionSheetNumber: myDead.productionSheetNumber,
            runningSeconds: myDead.runningSeconds,
          });
          setActivePhase(null);
          return;
        }

        const myPhase = (status.active || []).find(
          (a: any) => a.username === user.username
        );
        if (myPhase) {
          setActivePhase({
            username: myPhase.username,
            sheetId: myPhase.sheetId,
            productionSheetNumber: myPhase.productionSheetNumber,
            productId: myPhase.productId,
            phaseId: myPhase.phaseId,
            runningSeconds: myPhase.runningSeconds,
          });
        } else {
          setActivePhase(null);
        }
      } catch (e) {
        console.error("DeadTimeView load error:", e);
      }
    };

    load();
  }, [user]);

  const currentCodeMeta = DEAD_CODES.find((c) => c.code === selectedCode);

  const requiresProductManual = currentCodeMeta?.requiresProductManual;
  const requiresProductOrSheet = currentCodeMeta?.requiresProductOrSheet;

  const handleScanSuccess = async (decodedText: string) => {
    try {
      setScanError(null);

      // Uses your existing endpoint for production QR
      const raw = await api.getProductionSheetByQr(decodedText);

      setScannedSheetId(raw.id);
      setScannedOrderNumber(raw.orderNumber);
      setScannedSheetNumber(raw.productionSheetNumber);
      setScannedProductId(raw.productId);

      setUseScanner(false);
    } catch (err: any) {
      console.error("DeadTime scan error:", err);
      setScanError(err.message || t("deadTime.errors.readQrFailed"));
    }
  };

  const canStart = () => {
    if (!selectedCode) return false;

    if (requiresProductManual) {
      return manualProductId.trim().length > 0;
    }

    if (requiresProductOrSheet) {
      return (
        manualProductId.trim().length > 0 ||
        !!scannedSheetId ||
        !!scannedProductId
      );
    }

    return true;
  };

  const handleStart = async () => {
    if (!user || !selectedCode) return;
    if (!canStart()) {
      alert(t("deadTime.errors.requiredDetails"));
      return;
    }

    // if activeDead -> don't start another
    if (activeDead) {
      alert(t("deadTime.errors.alreadyActiveDead"));
      return;
    }

    // if activePhase -> respect rule (backend also checks)
    if (activePhase) {
      alert(t("deadTime.errors.activePhaseRunning"));
      return;
    }

    const meta = DEAD_CODES.find((c) => c.code === selectedCode);
    if (!meta) return;

    const payload: any = {
      username: user.username,
      code: selectedCode,
      description: t(`deadTime.codes.${selectedCode}`),
    };

    // priority: manual product > scanned product
    if (manualProductId.trim()) {
      payload.productId = manualProductId.trim();
    } else if (scannedProductId) {
      payload.productId = scannedProductId;
    }

    if (scannedSheetId) payload.sheetId = scannedSheetId;
    if (scannedOrderNumber) payload.orderNumber = scannedOrderNumber;
    if (scannedSheetNumber) payload.productionSheetNumber = scannedSheetNumber;

    setLoading(true);
    try {
      const started = await api.startDeadTime(payload);

      setActiveDead({
        id: started.id,
        code: started.code,
        description: started.description,
        productId: started.product_id,
        sheetId: started.sheet_id,
        orderNumber: started.order_number,
        productionSheetNumber: started.production_sheet_number,
        runningSeconds: 0,
      });

      // reset inputs
      setManualProductId("");
      setScannedSheetId(null);
      setScannedOrderNumber(null);
      setScannedSheetNumber(null);
      setScannedProductId(null);
    } catch (err: any) {
      console.error("startDeadTime error:", err);
      alert(err.message || t("deadTime.errors.startFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!activeDead) return;

    setLoading(true);
    try {
      await api.finishDeadTime(activeDead.id);
      setActiveDead(null);

      // after finish, reload live status
      if (user) {
        const status = await api.getLiveStatus();
        const myPhase = (status.active || []).find(
          (a: any) => a.username === user.username
        );
        setActivePhase(myPhase || null);
      }
    } catch (err: any) {
      console.error("finishDeadTime error:", err);
      alert(err.message || t("deadTime.errors.finishFailed"));
    } finally {
      setLoading(false);
    }
  };

  // ---------- UI ----------

  // Active DEAD TIME
  if (activeDead) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">
          {t("deadTime.activeDeadTitle")}
        </h2>

        <p className="mb-2">
          <b>{t("deadTime.labels.code")}:</b> {activeDead.code} –{" "}
          {activeDead.description}
        </p>

        {activeDead.orderNumber && activeDead.productionSheetNumber && (
          <p className="mb-1">
            <b>{t("deadTime.labels.sheet")}:</b> {activeDead.orderNumber}/
            {activeDead.productionSheetNumber}
          </p>
        )}

        {activeDead.productId && (
          <p className="mb-1">
            <b>{t("deadTime.labels.product")}:</b> {activeDead.productId}
          </p>
        )}

        <p className="mb-4">
          <b>{t("deadTime.labels.time")}:</b> {formatDuration(seconds)}
        </p>

        <button
          onClick={handleFinish}
          disabled={loading}
          className="w-full bg-red-600 text-white py-3 rounded-md disabled:opacity-60"
        >
          {t("deadTime.buttons.finish")}
        </button>
      </div>
    );
  }

  // Active PHASE TIME
  if (activePhase) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">
          {t("deadTime.activePhaseTitle")}
        </h2>

        <p className="mb-1">
          <b>{t("deadTime.labels.sheet")}:</b>{" "}
          {activePhase.productionSheetNumber}
        </p>

        <p className="mb-1">
          <b>{t("deadTime.labels.product")}:</b> {activePhase.productId}
        </p>

        <p className="mb-1">
          <b>{t("deadTime.labels.phase")}:</b> {activePhase.phaseId}
        </p>

        <p className="mb-4">
          <b>{t("deadTime.labels.running")}:</b>{" "}
          {Math.round(activePhase.runningSeconds / 60)} min
        </p>

        <p className="text-sm text-gray-600 mb-4">
          {t("deadTime.messages.cannotStartWhilePhaseRunning")}
        </p>
      </div>
    );
  }

  // Default UI
  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">{t("deadTime.title")}</h2>

      {/* Select code */}
      <div className="mb-4">
        <label className="block mb-1 font-semibold">
          {t("deadTime.labels.selectCode")}
        </label>
        <select
          className="w-full border rounded px-3 py-2"
          value={selectedCode ?? ""}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            setSelectedCode(v);

            // reset fields on code change
            setManualProductId("");
            setScannedSheetId(null);
            setScannedOrderNumber(null);
            setScannedSheetNumber(null);
            setScannedProductId(null);
            setUseScanner(false);
            setScanError(null);
          }}
        >
          <option value="">{t("deadTime.select.placeholder")}</option>
          {DEAD_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} – {t(`deadTime.codes.${c.code}`)}
            </option>
          ))}
        </select>
      </div>

      {selectedCode && (
        <>
          {/* Requirements info */}
          {requiresProductManual && (
            <p className="text-sm text-gray-600 mb-2">
              {t("deadTime.messages.requireManualProduct")}
            </p>
          )}

          {requiresProductOrSheet && (
            <p className="text-sm text-gray-600 mb-2">
              {t("deadTime.messages.requireProductOrScan")}
            </p>
          )}

          {/* Manual product ID */}
          {(requiresProductManual || requiresProductOrSheet) && (
            <div className="mb-4">
              <label className="block mb-1 font-semibold">
                {t("deadTime.labels.productManual")}
              </label>
              <input
                type="text"
                className="w-full border rounded px-3 py-2"
                value={manualProductId}
                onChange={(e) => setManualProductId(e.target.value)}
                placeholder={t("deadTime.labels.productManual")}
              />
            </div>
          )}

          {/* Scanner */}
          {requiresProductOrSheet && (
            <div className="mb-4">
              <label className="block mb-1 font-semibold">
                {t("deadTime.labels.scanQrOptional")}
              </label>

              {!useScanner && (
                <button
                  type="button"
                  onClick={() => setUseScanner(true)}
                  className="w-full bg-indigo-600 text-white py-2 rounded-md mb-2"
                >
                  {t("deadTime.buttons.startScanner")}
                </button>
              )}

              {useScanner && (
                <div className="mb-2">
                  <Scanner
                    onScanSuccess={handleScanSuccess}
                    onScanError={(msg) => setScanError(msg)}
                  />
                  <button
                    type="button"
                    onClick={() => setUseScanner(false)}
                    className="w-full bg-gray-500 text-white py-2 rounded-md mt-2"
                  >
                    {t("deadTime.buttons.closeScanner")}
                  </button>
                </div>
              )}

              {scanError && (
                <p className="text-sm text-red-600 mt-2">{scanError}</p>
              )}

              {(scannedSheetId || scannedProductId) && (
                <div className="mt-2 text-sm text-green-700 bg-green-50 p-2 rounded">
                  <p>
                    <b>{t("deadTime.labels.scannedSheet")}:</b>{" "}
                    {scannedOrderNumber && scannedSheetNumber
                      ? `${scannedOrderNumber}/${scannedSheetNumber}`
                      : scannedSheetId}
                  </p>
                  {scannedProductId && (
                    <p>
                      <b>{t("deadTime.labels.scannedProduct")}:</b>{" "}
                      {scannedProductId}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={handleStart}
        disabled={loading || !selectedCode || !canStart()}
        className="w-full bg-indigo-600 text-white py-3 rounded-md disabled:opacity-50"
      >
        {t("deadTime.buttons.startDeadTime")}
      </button>
    </div>
  );
};

export default DeadTimeView;
