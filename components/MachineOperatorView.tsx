import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type {
  ProductionSheetForOperator,
  Phase,
  PhaseLog,
  Material,
  ActionType
} from "../src/types";
import Scanner from "./Scanner";
import { useAuth } from "../hooks/useAuth";
import { useWarehouse } from "../hooks/useWarehouse";
import ConfirmModal from "../components/ConfirmModal";
import { mapPhaseLog } from "../src/mapPhaseLog";
import ActionModal from "./ActionModal";


type StageType = "find" | "setup" | "production";


/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

const safeInt = (v: any, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};


// phases in product snapshot may use id / phase_id / phaseId
const normalizeProductPhases = (rawProduct: any | null | undefined) => {
  if (!rawProduct) return { ...rawProduct, phases: [] as any[] };

  const phasesArr = Array.isArray(rawProduct.phases)
    ? rawProduct.phases
    : [];

  const normalizedPhases = phasesArr.map((p: any) => ({
    ...p,
    phaseId: String(p.phaseId ?? p.phase_id ?? p.id),
  }));

  return {
    ...rawProduct,
    phases: normalizedPhases,
  };
};

const buildProductionCode = (sheet: ProductionSheetForOperator | null): string => {
  if (!sheet) return "";
  const productCode = String(sheet.productId); 
  const order = String(sheet.orderNumber);
  return `${productCode}/${order}`;
};


/* ---------------------------------------------------------
   SAFELY RESOLVE MATERIALS - FRAMES
--------------------------------------------------------- */
const resolveMaterialsForPhase = (
  sheet: ProductionSheetForOperator | null,
  materials: Material[]
): Material[] => {
  if (!sheet) return [];

  const candidates = new Set<string>();
  const p = sheet.product;

  if (sheet.productId) candidates.add(String(sheet.productId).toLowerCase());
  if (p?.id) candidates.add(String(p.id).toLowerCase());

  const pm = Array.isArray(p?.materials) ? p.materials : [];
  for (const m of pm as any[]) {
    if (typeof m === "string") candidates.add(m.toLowerCase());
    else if (m) {
      if (m.materialId) candidates.add(String(m.materialId).toLowerCase());
      if (m.materialCode) candidates.add(String(m.materialCode).toLowerCase());
      if (m.sku) candidates.add(String(m.sku).toLowerCase());
      if (m.name) candidates.add(String(m.name).toLowerCase());
    }
  }

  return materials.filter(
    (wm) =>
      wm.materialCode &&
      candidates.has(String(wm.materialCode).toLowerCase()) &&
      (Number(wm.currentQuantity) || 0) > 0
  );
};

const resolveFramesForProduct = (
  sheet: ProductionSheetForOperator | null,
  frames: any[]
) => {
  if (!sheet) return [];

  const productId = String(sheet.productId);

  return frames.filter(
    (f) =>
      Array.isArray(f.productIds) &&
      f.productIds.includes(productId)
  );
};

/* ---------------------------------------------------------
   MAIN COMPONENT
--------------------------------------------------------- */
const MachineOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { materials } = useWarehouse();

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const resumeFromBackend = async () => {
      console.log("🔁 RESUME: checking live status...");
      try {
        // 🔴 STEP 0: check DEAD TIME FIRST
        const status = await api.getLiveStatus();
        if (cancelled) return;

        const myDead = (status.dead || []).find(
          (d: any) => d.username === user.username
        );

        if (myDead) {
          console.log("⛔ RESUME: dead time active, blocking machine view");
          setActiveDeadTime(myDead);
          return; // ⛔ STOP HERE — do NOT resume phases
        }

        setActiveDeadTime(null);

        console.log("🔁 RESUME: checking active phase...");
        const res = await api.getMyActivePhase();
        console.log("🔁 RESUME: backend response =", res);
        if (cancelled) return;
        if (!res.active) return;

        // 1️⃣ Load the correct sheet
        setViewState("idle");
        console.log(
          "🔁 RESUME: loading sheet from QR",
          res.active.qr_value
        );
        await handleScanSuccess(res.active.qr_value);
        console.log("🔁 RESUME: sheet loaded, restoring active phase state");

        if (cancelled) return;

        // 2️⃣ Rehydrate ACTIVE LOG (THIS WAS MISSING)
        const restoredLog: PhaseLog = {
          id: res.active.log_id,
          phaseId: String(res.active.phase_id),
          stage: res.active.stage,
          startTime: res.active.start_time,
          endTime: null,
          quantityDone: 0,
          operatorUsername: user.username,
        } as any;

        console.log("🔁 RESUME: restoredLog =", restoredLog);
        setActiveLog(restoredLog);

        // 3️⃣ Restore running stage
        setCurrentStage(res.active.stage);
        setCurrentStagePhaseId(String(res.active.phase_id));

        // 4️⃣ Resume timer
        setStageSeconds(res.active.running_seconds ?? 0);
        clearStageTimer();

        console.log("🔁 RESUME: state set", {
          activeLog: restoredLog,
          currentStage: res.active.stage,
          currentStagePhaseId: String(res.active.phase_id),
        });

        console.log(
          "⏱️ RESUME: starting timer at",
          res.active.running_seconds,
          "seconds"
        );

        stageTimerRef.current = window.setInterval(() => {
          setStageSeconds((s) => s + 1);
        }, 1000);
      } catch (e) {
        console.error("Auto-resume failed:", e);
      }
    };

    resumeFromBackend();

    return () => {
      cancelled = true;
    };
  }, [user]);



  const [materialInfo, setMaterialInfo] = useState<Material[] | null>(null);
  const [frameInfo, setFrameInfo] = useState<any[] | null>(null);
  const [viewState, setViewState] =
    useState<"idle" | "scanning" | "details">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activeLog, setActiveLog] = useState<PhaseLog | null>(null);
  
  const [activeDeadTime, setActiveDeadTime] = useState<any | null>(null);

  const [currentStage, setCurrentStage] = useState<StageType | null>(null);
  const [currentStagePhaseId, setCurrentStagePhaseId] = useState<string | null>(
    null
  );
  const stageTimerRef = useRef<number | null>(null);
  const modalResolverRef = useRef<((v: boolean) => void) | null>(null);
  const [stageSeconds, setStageSeconds] = useState(0);

  const [pendingStageTimes, setPendingStageTimes] = useState<
    Record<string, { find: number; setup: number }>
  >({});

  // Modal
  const [modalData, setModalData] = useState<{
    open: boolean;
    title: string;
    message: string;
    buttons: any[];
    resolver: null | ((v: boolean) => void);
  }>({
    open: false,
    title: "",
    message: "",
    buttons: [],
    resolver: null,
  });

  type ConsumeFlowState = {
    open: boolean;
    phaseId: string | null;
    quantityDone: number;
    candidates: Material[];
    selectedMaterial: Material | null;
  };

  const [consumeFlow, setConsumeFlow] = useState<ConsumeFlowState>({
    open: false,
    phaseId: null,
    quantityDone: 0,
    candidates: [],
    selectedMaterial: null,
  });

  const [consumeAction, setConsumeAction] = useState<ActionType | null>(null);

  const openModal = (title: string, message: string, buttons: any[]) =>
    new Promise<boolean>((resolve) => {
      modalResolverRef.current = resolve;
      setModalData({
        open: true,
        title,
        message,
        buttons,
        resolver: null, // <- don't rely on state for resolver
      });
    });

  const closeModal = (value: boolean) => {
    const r = modalResolverRef.current;
    modalResolverRef.current = null;
    r?.(value);
    setModalData((m) => ({ ...m, open: false }));
  };

  const clearStageTimer = () => {
    if (stageTimerRef.current) {
      window.clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };

  // Clear timer on unmount, just in case
  useEffect(() => {
    return () => {
      clearStageTimer();
    };
  }, []);

  /* ---------------------------------------------------------
     LOAD PHASE DEFINITIONS
  --------------------------------------------------------- */
  useEffect(() => {
    api.getPhases().then(setPhases).catch(console.error);
  }, []);

  /* ---------------------------------------------------------
     SAFE NORMALIZER FOR SHEET
  --------------------------------------------------------- */
  const normalizeSheet = (raw: any): ProductionSheetForOperator => {
    const product = normalizeProductPhases(raw.product || null);

    const rawLogs = Array.isArray(raw.phaseLogs)
      ? raw.phaseLogs
      : raw.phase_logs || [];

    const phaseLogs = rawLogs.map(mapPhaseLog);

    return {
      ...raw,
      phaseLogs,
      product,
    };
  };

  /* ---------------------------------------------------------
     SCAN SUCCESS
  --------------------------------------------------------- */
  const handleScanSuccess = async (decodedText: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const raw = await api.getProductionSheetByQr(decodedText);
      const data = normalizeSheet(raw);

      setSheet(data);

      const res = await api.getMyActivePhase();

      if (res.active && String(res.active.sheet_id) !== String(data.id)) {
        await openModal(
          "Active job in progress",
          "You already have a running job on another production sheet.",
          [{ label: "OK", type: "primary", onClick: () => closeModal(false) }]
        );
        return;
      }
      setViewState("details");
    } catch (err) {
      setError((err as Error).message);
      setViewState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     SAFE remaining calculation
  --------------------------------------------------------- */
  const computeRemainingForPhase = (phaseId: string): number => {
    if (!sheet) return 0;

    const phasesArr = sheet.product?.phases ?? [];
    const logs = sheet.phaseLogs ?? [];

    const doneByPhase = new Map<string, number>();
    phasesArr.forEach((p: any) =>
      doneByPhase.set(String(p.phaseId), 0)
    );

    logs.forEach((log) => {
      const key = String(log.phaseId);
      doneByPhase.set(
        key,
        (doneByPhase.get(key) || 0) + (log.quantityDone || 0)
      );
    });

    const idx = phasesArr.findIndex(
      (p: any) => String(p.phaseId) === String(phaseId)
    );
    if (idx < 0) return 0;

    const upstreamDone =
      idx === 0
        ? sheet.quantity
        : doneByPhase.get(String(phasesArr[idx - 1].phaseId)) || 0;

    const alreadyDoneHere = doneByPhase.get(String(phaseId)) || 0;
    return Math.max(0, upstreamDone - alreadyDoneHere);
  };

  const canStartPhase = (phaseId: string): boolean => {
    if (!sheet) return false;

    const phasesArr = sheet.product?.phases ?? [];
    const idx = phasesArr.findIndex((p: any) => String(p.phaseId) === String(phaseId));
    if (idx < 0) return false;

    // first phase is always startable (upstream = sheet.quantity)
    if (idx === 0) return true;

    const prevId = String(phasesArr[idx - 1].phaseId);
    const prevDone = phaseStatuses.get(prevId)?.done || 0;

    const myDone = phaseStatuses.get(String(phaseId))?.done || 0;
    const canStartQty = Math.max(0, prevDone - myDone);

    return canStartQty > 0;
  };

  /* ---------------------------------------------------------
     SAFE STATUS MAP
  --------------------------------------------------------- */
  const phaseStatuses = useMemo(() => {
    if (!sheet) return new Map();

    const phasesArr = sheet.product?.phases ?? [];
    const logs = sheet.phaseLogs ?? [];

    const statuses = new Map<
      string,
      { done: number; total: number; inProgress: boolean }
    >();

    phasesArr.forEach((p: any) =>
      statuses.set(String(p.phaseId), {
        done: 0,
        total: sheet.quantity,
        inProgress: false,
      })
    );

    logs.forEach((log) => {
      const key = String(log.phaseId);
      const st = statuses.get(key);
      if (!st) return;
      st.done += log.quantityDone || 0;
      if (!log.endTime) st.inProgress = true;
    });

    return statuses;
  }, [sheet]);

  useEffect(() => {
    if (!sheet) {
      setMaterialInfo(null);
      setFrameInfo(null);
      return;
    }

    const hasPhase2or30 = (sheet.product?.phases ?? []).some((p: any) =>
      ["2", "30"].includes(String(p.phaseId))
    );

    if (!hasPhase2or30) {
      setMaterialInfo(null);
      return;
    }

    // phase is considered "completed" if total done >= sheet.quantity
    const done2 = phaseStatuses.get("2")?.done || 0;
    const done30 = phaseStatuses.get("30")?.done || 0;
    const phase2or30Completed = done2 >= sheet.quantity || done30 >= sheet.quantity;

    if (phase2or30Completed) {
      setMaterialInfo(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const freshMaterials = await api.getMaterials();
        if (cancelled) return;

        // resolveMaterialsForPhase already filters > 0 now
        const filtered = resolveMaterialsForPhase(sheet, freshMaterials);
        setMaterialInfo(filtered.length ? filtered : null);
      } catch (e) {
        console.error("material info refresh failed:", e);
      }
    })();


    // ===== FRAME INFO (PHASE 21) =====
    const hasPhase21 = (sheet.product?.phases ?? []).some(
      (p: any) => String(p.phaseId) === "21"
    );

    if (!hasPhase21) {
      setFrameInfo(null);
    } else {
      const done21 = phaseStatuses.get("21")?.done || 0;
      const phase21Completed = done21 >= sheet.quantity;

      // NEW: only show when phase 21 is actually startable/unlocked
      const phase21Startable = canStartPhase("21");

      if (phase21Completed || !phase21Startable) {
        setFrameInfo(null);
      } else {
        (async () => {
          try {
            const allFrames = await api.getFrames();
            const linkedFrames = resolveFramesForProduct(sheet, allFrames);
            setFrameInfo(linkedFrames.length ? linkedFrames : null);
          } catch (e) {
            console.error("frame info refresh failed:", e);
          }
        })();
      }
    }

    return () => {
      cancelled = true;
    };
  }, [sheet, phaseStatuses]);


  /* ---------------------------------------------------------
     FINISH PREVIOUS PHASE DIALOG
  --------------------------------------------------------- */
  const ensurePreviousPhaseClosed = async () => {

    if (activeDeadTime) {
      await openModal(
        "Dead time running",
        "You have an active dead-time. Finish it before starting a phase.",
        [{ label: "OK", type: "primary", onClick: () => closeModal(false) }]
      );
      return false;
    }

    if (!activeLog) return true;

    const runningStage = (activeLog as any).stage as StageType | undefined;

    const stageLabel =
      runningStage === "find" ? "Find material" :
      runningStage === "setup" ? "Setup" :
      "Production";

    const confirm = await openModal(
      `${stageLabel} still running`,
      `You already have an active ${stageLabel} log. Finish it first?`,
      [
        { label: "Finish it", type: "primary", onClick: () => closeModal(true) },
        { label: "Cancel", type: "secondary", onClick: () => closeModal(false) },
      ]
    );

    if (!confirm) return false;

    if (runningStage === "production") await finishProductionStage(false);
    else await finishSimpleStage();

    return true;
  };



  /* ---------------------------------------------------------
     START SIMPLE STAGES (find/setup)
  --------------------------------------------------------- */
  const startSimpleStage = async (phaseId: string, stage: StageType) => {
    if (stage === "production") return;
    if (!sheet || !user?.username) return;

    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) return alert("Nothing to start.");

    setIsLoading(true);
    setError(null);

    try {
      // 1) create the log FIRST
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        startTime: new Date().toISOString(),
        // ⚠️ see note below about totalQuantity=0
        totalQuantity: 0,
        stage,
      });

      setActiveLog(mapPhaseLog(newLog));

      // 2) start live phase
      const def: any = sheet.product?.phases?.find((p: any) => String(p.phaseId) === String(phaseId));
      const plannedTime =
        (def?.setupTime || 0) + (def?.productionTimePerPiece || 0) * remainingForPhase;

      await api.startLivePhase({
        username: user.username,
        sheetId: sheet.id,
        productId: sheet.productId,
        phaseId,
        plannedTime,
        status: stage === "find" ? "search" : "setup",
      });

      // 3) only now start UI timer
      setCurrentStage(stage);
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);

      clearStageTimer();
      stageTimerRef.current = window.setInterval(() => {
        setStageSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error("startSimpleStage error:", e);
      setError((e as Error).message);
      // ✅ ensure UI isn't stuck
      clearStageTimer();
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setStageSeconds(0);
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     FINISH SIMPLE STAGES
  --------------------------------------------------------- */
  const finishSimpleStage = async () => {
    if (!currentStage || !currentStagePhaseId) return;

    clearStageTimer();

    const phaseId = currentStagePhaseId;
    const seconds = stageSeconds;

    // snapshot the log id NOW (state may change async)
    const logId = activeLog?.id;

    setIsLoading(true);
    try {
      if (!logId) {
        throw new Error("No activeLog to finish (startPhase probably failed).");
      }

      await api.finishPhase(logId, new Date().toISOString(), 0, seconds);

      if (user?.username) {
        await api.stopLivePhase(user.username);
      }

      setActiveLog(null);
    } catch (e) {
      console.error("finishSimpleStage error:", e);
      setError((e as Error).message);
    } finally {
      // ✅ ALWAYS unlock UI
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setIsLoading(false);
    }
  };


  /* ---------------------------------------------------------
     START PRODUCTION (FULLY PATCHED)
  --------------------------------------------------------- */
  const startProductionStage = async (phaseId: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;

    const remainingForPhase = computeRemainingForPhase(phaseId);
    if (remainingForPhase <= 0) return alert("Nothing to start.");

    const times = pendingStageTimes[phaseId] || { find: 0, setup: 0 };
    setIsLoading(true);

    const phase = sheet.product.phases.find((p: any) => String(p.phaseId) === String(phaseId));
    console.log("Phase position:", phase?.position); // Check if position exists

    try {
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        startTime: new Date().toISOString(),
        totalQuantity: remainingForPhase, // ⭐ key fix
        findMaterialTime: times.find || 0,
        setupTime: times.setup || 0,
        stage: 'production',
      });

      const normalizedLog = mapPhaseLog(newLog);
      setActiveLog(normalizedLog);

      setPendingStageTimes((prev) => {
        const copy = { ...prev };
        delete copy[phaseId];
        return copy;
      });

      // Start live
      try {
        const def: any = sheet.product?.phases?.find(
          (p: any) => String(p.phaseId) === String(phaseId)
        );
        if (def) {
          const planned =
            (def.productionTimePerPiece || 0) * remainingForPhase;

          await api.startLivePhase({
            username: user.username,
            sheetId: sheet.id,
            productId: sheet.productId,
            phaseId,
            plannedTime: planned,
            status: "production",
          });
        }
      } catch (e) {
        console.error("startProductionStage live start error:", e);
      }

      clearStageTimer();
      setCurrentStage("production");
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);

      stageTimerRef.current = window.setInterval(() => {
        setStageSeconds((s) => s + 1);
      }, 1000);
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     FINISH PRODUCTION (FULL / PARTIAL)
  --------------------------------------------------------- */
  const finishProductionStage = async (isPartial: boolean) => {
    if (!activeLog || !sheet) return;

    const phaseId = String(activeLog.phaseId);
    const remaining = computeRemainingForPhase(phaseId);

    if (remaining <= 0) {
      alert("Nothing remaining to finish.");
      return;
    }

    let quantityDone = remaining;

    if (isPartial) {
      const qtyStr = prompt(`Enter quantity (1–${remaining}):`);
      if (qtyStr === null) return;

      const qty = parseInt(qtyStr.trim(), 10);
      if (!Number.isFinite(qty) || qty <= 0 || qty > remaining) {
        alert("Invalid quantity.");
        return;
      }
      quantityDone = qty;
    }

    clearStageTimer();
    const productionSeconds = stageSeconds;

    // we'll decide consume AFTER loading finishes
    const finishedPhaseId = phaseId;
    const shouldAskConsume = ["2", "30"].includes(finishedPhaseId) && quantityDone > 0;

    let updatedSheet: ProductionSheetForOperator | null = null;

    setIsLoading(true);
    try {
      await api.finishPhase(activeLog.id, new Date().toISOString(), quantityDone, productionSeconds);

      if (user) {
        api.stopLivePhase(user.username).catch((e) =>
          console.error("finishProductionStage stop live error:", e)
        );
      }

      setActiveLog(null);
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);

      const updatedRaw = await api.getProductionSheetByQr(sheet.qrValue);
      updatedSheet = normalizeSheet(updatedRaw);
      setSheet(updatedSheet);
    } catch (e) {
      console.error("finishProductionStage error:", e);
      setError((e as Error).message);
      return; // don't continue to consume flow on failure
    } finally {
      setIsLoading(false); // ✅ IMPORTANT: turn off loading BEFORE consume UI
    }

    // ✅ NOW we are not in loading screen, safe to show consume prompt + UI
    if (!shouldAskConsume) return;

    const confirmConsume = await openModal(
      t("machineOperator.consumeNowTitle"),
      t("machineOperator.consumeNowMessage"),
      [
        { label: t("common.yes"), type: "primary", onClick: () => closeModal(true) },
        { label: t("common.no"), type: "secondary", onClick: () => closeModal(false) },
      ]
    );

    if (!confirmConsume) return;

    // ✅ allow ConfirmModal to unmount before opening another modal/UI
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    // IMPORTANT: don't rely on stale materialInfo; fetch fresh list
    const freshMaterials = await api.getMaterials();

    const candidates = resolveMaterialsForPhase(updatedSheet ?? sheet, freshMaterials);

    if (!candidates.length) {
      await openModal(
        t("machineOperator.noMaterialsTitle"),
        t("machineOperator.noMaterialsMessage"),
        [{ label: "OK", type: "primary", onClick: () => closeModal(false) }]
      );
      return;
    }

    setConsumeAction(null);
    // open selection UI
    setConsumeFlow({
      open: true,
      phaseId: finishedPhaseId,
      quantityDone,
      candidates,
      selectedMaterial: null,
    });

    // keep the top info updated
    setMaterialInfo(candidates);
  };

    /* ---------------------------------------------------------
      RESET
    --------------------------------------------------------- */
    const resetView = () => {
      setSheet(null);
      setError(null);
      setActiveLog(null);
      clearStageTimer();
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setPendingStageTimes({});
      setViewState("idle");
    };


  /* ---------------------------------------------------------
     SCANNING
  --------------------------------------------------------- */
  if (viewState === "scanning")
    return (
      <>
        <ConfirmModal
          open={modalData.open}
          title={modalData.title}
          message={modalData.message}
          buttons={modalData.buttons}
          onClose={closeModal}
        />
        {isLoading && (
          <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl px-6 py-4">
              {t("common.loading")}
            </div>
          </div>
        )}
        <div className="max-w-xl mx-auto">
          <Scanner
            onScanSuccess={handleScanSuccess}
            onScanError={(msg) => setError(msg)}
          />
          <button
            onClick={() => setViewState("idle")}
            className="mt-4 w-full bg-gray-500 text-white py-2 rounded-md"
          >
            {t("common.cancel")}
          </button>

          {error && (
            <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">
              {error}
            </p>
          )}
        </div>
      </>
    );


  /* ---------------------------------------------------------
    BLOCK IF DEAD TIME IS ACTIVE
  --------------------------------------------------------- */
  if (activeDeadTime) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">Active Dead Time</h2>
        <p className="mb-2">
          <strong>Code:</strong> {activeDeadTime.code}
        </p>
        <p className="text-sm text-gray-600 mb-4">
          You cannot start or resume production while a dead-time is active.
          Finish it from the Dead Time tab.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------------
     DETAILS GUARDS
  --------------------------------------------------------- */
  if (viewState === "details") {
    if (!sheet) return <div style={{ padding: 20 }}>DEBUG: no sheet</div>;

    if (!sheet.product || !Array.isArray(sheet.product.phases))
      return (
        <div style={{ padding: 20 }}>
          Invalid sheet structure
          <br />
          {JSON.stringify(sheet, null, 2)}
        </div>
      );
  }

  /* ---------------------------------------------------------
     DETAILS VIEW
  --------------------------------------------------------- */
  if (viewState === "details" && sheet) {
    const logs = sheet.phaseLogs ?? [];

    return (
      <>
        <ConfirmModal
          open={modalData.open}
          title={modalData.title}
          message={modalData.message}
          buttons={modalData.buttons}
          onClose={closeModal}
        />
        {isLoading && (
          <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-xl px-6 py-4">
              {t("common.loading")}
            </div>
          </div>
        )}
        <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">
            {t("machineOperator.sheetDetails")}
          </h2>

          {/* SHEET INFO */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-md">
            <p>
              <strong>{t("machineOperator.orderNum")}:</strong>{" "}
              {sheet.orderNumber}
            </p>
            <p>
              <strong>{t("machineOperator.sheetNum")}:</strong>{" "}
              {sheet.productionSheetNumber}
            </p>
            <p>
              <strong>{t("machineOperator.product")}:</strong>{" "}
              {sheet.productId}
            </p>
            <p>
              <strong>{t("machineOperator.qty")}:</strong> {sheet.quantity}
            </p>
          </div>

          {/* MATERIAL INFO */}
          {Array.isArray(materialInfo) && materialInfo.length > 0 && (
            <div className="p-4 my-4 border rounded-md bg-indigo-50">
              <h4 className="font-semibold mb-2">
                {t("machineOperator.materialInfo")}
              </h4>

              <div className="space-y-3">
                {materialInfo.map((mat) => (
                  <div key={mat.id} className="p-3 bg-white border rounded-md">
                    <p>
                      <strong>{t("common.material")}:</strong>{" "}
                      {mat.materialCode}
                    </p>
                    <p>
                      <strong>{t("common.quantity")}:</strong>{" "}
                      {mat.currentQuantity} / {mat.initialQuantity}
                    </p>
                    <p>
                      <strong>{t("common.location")}:</strong>{" "}
                      {mat.location
                        ? `${mat.location.area}, Pos ${mat.location.position}`
                        : t("common.na")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FRAME INFO */}
          {Array.isArray(frameInfo) && frameInfo.length > 0 && (
            <div className="p-4 my-4 border rounded-md bg-emerald-50">
              <h4 className="font-semibold mb-2">
                {t("machineOperator.frameInfo") ?? "Frame Information"}
              </h4>

              <div className="space-y-3">
                {frameInfo.map((f) => (
                  <div key={f.frameId} className="p-3 bg-white border rounded-md">
                    <p>
                      <strong>Frame:</strong> FRAME {f.frameId}
                    </p>
                    <p>
                      <strong>Position:</strong>{" "}
                      {f.position ?? "—"}
                    </p>
                    <p>
                      <strong>Quality:</strong>{" "}
                      {f.quality ?? "—"}
                    </p>
                    <p>
                      <strong>Size:</strong>{" "}
                      {f.widthCm && f.heightCm
                        ? `${f.widthCm} × ${f.heightCm} cm`
                        : "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONSUME FLOW: SELECT MATERIAL (MODAL WINDOW) */}
          {consumeFlow.open && !consumeFlow.selectedMaterial && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
                <div className="p-5 border-b flex justify-between items-center">
                  <h4 className="text-xl font-semibold text-gray-800">
                    {t("machineOperator.selectMaterialTitle")}
                  </h4>

                  <button
                    onClick={() =>
                      setConsumeFlow({
                        open: false,
                        phaseId: null,
                        quantityDone: 0,
                        candidates: [],
                        selectedMaterial: null,
                      })
                    }
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-5">
                  <p className="text-sm text-gray-700 mb-4">
                    {t("machineOperator.selectMaterialHint", {
                      qty: consumeFlow.quantityDone,
                      phaseId: consumeFlow.phaseId,
                    })}
                  </p>

                  <div className="space-y-2 max-h-[60vh] overflow-auto">
                    {consumeFlow.candidates.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="w-full text-left p-3 bg-white border rounded-md hover:bg-gray-50"
                        onClick={() =>
                          setConsumeFlow((prev) => ({ ...prev, selectedMaterial: m }))
                        }
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <div className="font-mono">{m.materialCode}</div>
                            <div className="text-xs text-gray-600">
                              {m.location
                                ? `${m.location.area}, Pos ${m.location.position}`
                                : t("common.na")}
                            </div>
                          </div>
                          <div className="text-sm whitespace-nowrap">
                            {m.currentQuantity} / {m.initialQuantity}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="button"
                      className="bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300"
                      onClick={() =>
                        setConsumeFlow({
                          open: false,
                          phaseId: null,
                          quantityDone: 0,
                          candidates: [],
                          selectedMaterial: null,
                        })
                      }
                    >
                      {t("machineOperator.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CONSUME FLOW: CHOOSE ACTION (MODAL WINDOW) */}
          {consumeFlow.open && consumeFlow.selectedMaterial && !consumeAction && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-5 border-b flex justify-between items-center">
                  <h4 className="text-xl font-semibold text-gray-800">
                    {t("machineOperator.consumeActionTitle")}
                  </h4>

                  <button
                    onClick={() => {
                      // back to picker (or cancel everything if you prefer)
                      setConsumeAction(null);
                      setConsumeFlow((prev) => ({ ...prev, selectedMaterial: null }));
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-5 space-y-3">
                  <div className="text-sm text-gray-600">
                    <div>
                      <strong>{t("common.material")}:</strong>{" "}
                      <span className="font-mono">{consumeFlow.selectedMaterial.materialCode}</span>
                    </div>
                    <div className="mt-1">
                      <strong>{t("common.quantity")}:</strong>{" "}
                      {consumeFlow.selectedMaterial.currentQuantity} / {consumeFlow.selectedMaterial.initialQuantity}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      className="bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700"
                      onClick={() => setConsumeAction("CONSUMPTION")}
                    >
                      {t("machineOperator.fullConsumption")}
                    </button>

                    <button
                      type="button"
                      className="bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700"
                      onClick={() => setConsumeAction("PARTIAL_CONSUMPTION")}
                    >
                      {t("machineOperator.partialConsumptionRelocate")}
                    </button>
                  </div>

                  <div className="pt-2 flex justify-between gap-3">
                    <button
                      type="button"
                      className="w-1/2 bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300"
                      onClick={() => {
                        // back to picker
                        setConsumeAction(null);
                        setConsumeFlow((prev) => ({ ...prev, selectedMaterial: null }));
                      }}
                    >
                      {t("common.back") ?? "Back"}
                    </button>

                    <button
                      type="button"
                      className="w-1/2 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
                      onClick={() => {
                        // cancel consume flow completely
                        setConsumeAction(null);
                        setConsumeFlow({
                          open: false,
                          phaseId: null,
                          quantityDone: 0,
                          candidates: [],
                          selectedMaterial: null,
                        });
                      }}
                    >
                      {t("machineOperator.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ✅ CONSUME FLOW: ACTION MODAL */}
          {consumeAction && consumeFlow.selectedMaterial && (
            <ActionModal
              actionType={consumeAction}
              material={consumeFlow.selectedMaterial}
              initialProductionCode={buildProductionCode(sheet)}
              onClose={() => setConsumeAction(null)}
              onComplete={async () => {
                setConsumeAction(null);
                setConsumeFlow({
                  open: false,
                  phaseId: null,
                  quantityDone: 0,
                  candidates: [],
                  selectedMaterial: null,
                });

                const freshMaterials = await api.getMaterials();
                setMaterialInfo(resolveMaterialsForPhase(sheet, freshMaterials));
              }}
            />
          )}

          {/* PHASES */}
          <h3 className="text-xl font-semibold mb-2">
            {t("machineOperator.phases")}
          </h3>

          <div className="space-y-3">
            {sheet.product.phases.map((phase: any, index: number) => {
              const phaseId = String(phase.phaseId);

              const status = phaseStatuses.get(phaseId) || {
                done: 0,
                total: sheet.quantity,
                inProgress: false,
              };

              const isUnlocked =
                index === 0 ||
                (phaseStatuses.get(
                  String(sheet.product.phases[index - 1].phaseId)
                )?.done || 0) > 0;

              const prevDone =
                index === 0
                  ? sheet.quantity
                  : phaseStatuses.get(
                      String(sheet.product.phases[index - 1].phaseId)
                    )?.done || 0;

              const canStartQty = Math.max(0, prevDone - status.done);

              const hasSetup =
                (sheet.product.phases.find(
                  (p: any) => String(p.phaseId) === phaseId
                )?.setupTime || 0) > 0;

              const isPhaseLocked = canStartQty <= 0;

              const isMyCurrentPhase =
                currentStagePhaseId === phaseId && currentStage !== null;
              const isRunningFind =
                isMyCurrentPhase && currentStage === "find";
              const isRunningSetup =
                isMyCurrentPhase && currentStage === "setup";
              const isRunningProduction =
                isMyCurrentPhase && currentStage === "production";

              return (
                <div
                  key={phaseId}
                  className="p-3 border rounded-md flex justify-between items-center bg-white"
                >
                  {/* LEFT SIDE */}
                  <div>
                    <p className="font-bold text-lg">
                      {phases.find((p) => String(p.id) === phaseId)?.name ||
                        `Phase ${phaseId}`}
                    </p>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        {t("machineOperator.status")}{" "}
                        <span className="font-semibold">
                          {status.done} / {sheet.quantity}
                        </span>
                      </p>

                      {/* IN PROGRESS */}
                      {logs.some(
                        (l) => !l.endTime && String(l.phaseId) === phaseId
                      ) && (
                        <p className="text-yellow-600">
                          🟡 In progress by{" "}
                          {logs
                            .filter(
                              (l) =>
                                !l.endTime &&
                                String(l.phaseId) === phaseId
                            )
                            .map((l) => l.operatorUsername)
                            .join(", ")}
                        </p>
                      )}

                      {/* DONE */}
                      {logs.some(
                        (l) => l.endTime && String(l.phaseId) === phaseId
                      ) && (
                        <p className="text-green-700">
                          ✅ Done by{" "}
                          {logs
                            .filter(
                              (l) =>
                                l.endTime &&
                                String(l.phaseId) === phaseId &&
                                (l.quantityDone || 0) > 0
                            )
                            .map(
                              (l) =>
                                `${l.operatorUsername} (${l.quantityDone})`
                            )
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* RIGHT SIDE */}
                  <div className="flex flex-col items-end gap-2">
                    {/* FIND / SETUP */}
                    {(isRunningFind || isRunningSetup) && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={finishSimpleStage}
                          className="btn-secondary"
                        >
                          {t("machineOperator.finish")}
                        </button>
                        <p className="text-xs text-gray-500">
                          {currentStage === "find"
                            ? `Finding Material: ${stageSeconds}s`
                            : `Setup: ${stageSeconds}s`}
                        </p>
                      </div>
                    )}

                    {/* PRODUCTION */}
                    {isRunningProduction && (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex gap-2">
                          <button
                            onClick={() => finishProductionStage(true)}
                            className="btn-secondary"
                          >
                            {t("machineOperator.finishPartial")}
                          </button>
                          <button
                            onClick={() => finishProductionStage(false)}
                            className="btn-primary"
                          >
                            {t("machineOperator.finishFull")}
                          </button>
                        </div>

                        <p className="text-xs text-gray-500">
                          Production: {stageSeconds}s
                        </p>
                      </div>
                    )}

                    {/* START BUTTONS */}
                    {!currentStage && !isPhaseLocked && isUnlocked && (
                      <div className="flex flex-col items-end gap-2">
                        {(phaseId === "2" || phaseId === "30") && (
                          <button
                            onClick={() =>
                              startSimpleStage(phaseId, "find")
                            }
                            className="btn-secondary"
                          >
                            Find Material
                          </button>
                        )}

                        {hasSetup && (
                          <button
                            onClick={() =>
                              startSimpleStage(phaseId, "setup")
                            }
                            className="btn-secondary"
                          >
                            Start Setup
                          </button>
                        )}

                        <button
                          onClick={() => startProductionStage(phaseId)}
                          className="btn-primary"
                        >
                          Start Production
                        </button>
                      </div>
                    )}

                    {/* BUSY */}
                    {currentStage && !isMyCurrentPhase && (
                      <p className="text-xs text-gray-400">
                        Busy on another phase…
                      </p>
                    )}

                    {/* DONE PHASE */}
                    {isPhaseLocked && (
                      <p className="text-xs text-gray-400">
                        Phase complete
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* BOTTOM BUTTON */}
          <button
            onClick={resetView}
            className="mt-6 w-full text-indigo-600 hover:underline"
          >
            {t("operator.scanAnother")}
          </button>

          {/* BUTTON STYLES */}
          <style>{`
            .btn-primary{
              padding:.5rem 1rem;
              background:#4F46E5;
              color:#fff;
              border-radius:6px;
              font-weight:500;
            }
            .btn-secondary{
              padding:.5rem 1rem;
              background:#E5E7EB;
              color:#374151;
              border-radius:6px;
              font-weight:500;
            }
          `}</style>
        </div>
      </>
    );
  }

  /* ---------------------------------------------------------
     DEFAULT IDLE
  --------------------------------------------------------- */
  return (
    <>
      <ConfirmModal
        open={modalData.open}
        title={modalData.title}
        message={modalData.message}
        buttons={modalData.buttons}
        onClose={closeModal}
      />
      {isLoading && (
        <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl px-6 py-4">
            {t("common.loading")}
          </div>
        </div>
      )}
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">{t("machineOperator.title")}</h2>
        <p className="text-gray-600 mb-6">{t("machineOperator.scanPrompt")}</p>

        <button
          onClick={() => setViewState("scanning")}
          className="w-full bg-indigo-600 text-white py-3 rounded-md"
        >
          {t("machineOperator.startScan")}
        </button>

        {error && (
          <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">
            {error}
          </p>
        )}
      </div>
    </>
  );
};

export default MachineOperatorView;
