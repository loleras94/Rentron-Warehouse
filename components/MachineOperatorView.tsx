import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type {
  ProductionSheetForOperator,
  Phase,
  PhaseLog,
  Material,
  ActionType,
} from "../src/types";
import Scanner from "./Scanner";
import { useAuth } from "../hooks/useAuth";
import ConfirmModal from "../components/ConfirmModal";
import { mapPhaseLog } from "../src/mapPhaseLog";
import ActionModal from "./ActionModal";

type StageType = "find" | "setup" | "production";

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

// Composite key for phase
const phaseKeyOf = (p: any) => `${String(p.phaseId)}@${String(p.position ?? "")}`;

// phases in product snapshot may use id / phase_id / phaseId
const normalizeProductPhases = (rawProduct: any | null | undefined) => {
  if (!rawProduct) return { ...rawProduct, phases: [] as any[] };

  const phasesArr = Array.isArray(rawProduct.phases) ? rawProduct.phases : [];

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

const resolveFramesForProduct = (sheet: ProductionSheetForOperator | null, frames: any[]) => {
  if (!sheet) return [];
  const productId = String(sheet.productId);

  return frames.filter((f) => Array.isArray(f.productIds) && f.productIds.includes(productId));
};

/* ---------------------------------------------------------
   MAIN COMPONENT
--------------------------------------------------------- */
const MachineOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [materialInfo, setMaterialInfo] = useState<Material[] | null>(null);
  const [frameInfo, setFrameInfo] = useState<any[] | null>(null);
  const [viewState, setViewState] = useState<"idle" | "scanning" | "details">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [activeLog, setActiveLog] = useState<PhaseLog | null>(null);

  const [activeDeadTime, setActiveDeadTime] = useState<any | null>(null);

  const [currentStage, setCurrentStage] = useState<StageType | null>(null);
  const [currentStagePhaseId, setCurrentStagePhaseId] = useState<string | null>(null);

  const stageTimerRef = useRef<number | null>(null);
  const modalResolverRef = useRef<((v: boolean) => void) | null>(null);
  const [stageSeconds, setStageSeconds] = useState(0);

  const [pendingStageTimes, setPendingStageTimes] = useState<Record<string, { find: number; setup: number }>>({});
  const [activeMultiJob, setActiveMultiJob] = useState<any | null>(null);

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
        resolver: null,
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

    const rawLogs = Array.isArray(raw.phaseLogs) ? raw.phaseLogs : raw.phase_logs || [];
    const phaseLogs = rawLogs.map(mapPhaseLog);

    return {
      ...raw,
      phaseLogs,
      product,
    };
  };

  const refreshCurrentSheet = async (qrValue?: string) => {
    const qr = qrValue || sheet?.qrValue;
    if (!qr) return;
    const updatedRaw = await api.getProductionSheetByQr(qr);
    setSheet(normalizeSheet(updatedRaw));
  };

  /* ---------------------------------------------------------
     RESUME FROM BACKEND
  --------------------------------------------------------- */
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const resumeFromBackend = async () => {
      try {
        // check dead time
        const status = await api.getLiveStatus();
        if (cancelled) return;

        const myDead = (status.dead || []).find((d: any) => d.username === user.username);
        if (myDead) {
          setActiveDeadTime(myDead);
          return;
        }

        setActiveDeadTime(null);

        // ✅ block if multi session running
        const myMulti = (status.active || []).find(
          (x: any) => x.username === user.username && String(x.status || "") === "multi"
        );

        if (myMulti) {
          setActiveMultiJob(myMulti);
          return;
        }

        setActiveMultiJob(null);

        const res = await api.getMyActivePhase();

        if (cancelled) return;
        if (!res.active) return;

        setViewState("idle");

        await handleScanSuccess(res.active.qr_value);
        if (cancelled) return;

        const restoredLog: PhaseLog = {
          id: res.active.id,
          phaseId: String(res.active.phase_id),
          position: res.active.position,
          productionPosition: res.active.production_position,
          stage: res.active.stage,
          startTime: res.active.start_time,
          endTime: null,
          quantityDone: 0,
          operatorUsername: user.username,
        } as any;

        setActiveLog(restoredLog);
        setCurrentStage(res.active.stage);
        setCurrentStagePhaseId(String(res.active.phase_id));

        setStageSeconds(res.active.running_seconds ?? 0);
        clearStageTimer();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
          t("machineOperator.modals.activeJobTitle"),
          t("machineOperator.modals.activeJobMessage"),
          [{ label: t("common.ok"), type: "primary", onClick: () => closeModal(false) }]
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
     SORTED PHASES + STATUS MAP
  --------------------------------------------------------- */
  const sortedPhases = useMemo(() => {
    if (!sheet?.product?.phases) return [];
    return (sheet.product.phases ?? []).sort((a, b) => {
      return (Number((a as any).productionPosition) || 0) - (Number((b as any).productionPosition) || 0);
    });
  }, [sheet]);

  const phaseStatuses = useMemo(() => {
    if (!sheet) return new Map();

    const logs = sheet.phaseLogs ?? [];
    const statuses = new Map<string, { done: number; total: number; inProgress: boolean }>();

    sortedPhases.forEach((p: any) =>
      statuses.set(phaseKeyOf(p), {
        done: 0,
        total: sheet.quantity,
        inProgress: false,
      })
    );

    logs.forEach((log) => {
      const key = phaseKeyOf(log);
      const st = statuses.get(key);
      if (!st) return;
      st.done += log.quantityDone || 0;
      if (!log.endTime) st.inProgress = true;
    });

    return statuses;
  }, [sheet, sortedPhases]);

  /* ---------------------------------------------------------
     SAFE remaining calculation
  --------------------------------------------------------- */
  const computeRemainingForPhase = (phaseId: string, position: string): number => {
    if (!sheet) return 0;

    const phasesArr = sortedPhases ?? [];
    const logs = sheet.phaseLogs ?? [];

    const phaseObj = phasesArr.find(
      (p: any) => String(p.phaseId) === String(phaseId) && String(p.position) === String(position)
    );

    if (!phaseObj) return 0;

    const doneByPhase = new Map<string, number>();
    phasesArr.forEach((p: any) => doneByPhase.set(phaseKeyOf(p), 0));

    logs.forEach((log: any) => {
      const key = phaseKeyOf(log);
      doneByPhase.set(key, (doneByPhase.get(key) || 0) + (log.quantityDone || 0));
    });

    const idx = phasesArr.findIndex((p: any) => phaseKeyOf(p) === phaseKeyOf(phaseObj));
    if (idx < 0) return 0;

    const upstreamDone = idx === 0 ? sheet.quantity : doneByPhase.get(phaseKeyOf(phasesArr[idx - 1])) || 0;
    const alreadyDoneHere = doneByPhase.get(phaseKeyOf(phaseObj)) || 0;

    return Math.max(0, upstreamDone - alreadyDoneHere);
  };

  const canStartPhase = (phaseId: string): boolean => {
    if (!sheet) return false;

    const phasesArr = sheet.product?.phases ?? [];
    const idx = phasesArr.findIndex((p: any) => String(p.phaseId) === String(phaseId));
    if (idx < 0) return false;
    if (idx === 0) return true;

    const prevPhase = phasesArr[idx - 1];
    const prevKey = phaseKeyOf(prevPhase);
    const prevDone = phaseStatuses.get(prevKey)?.done || 0;

    const currentPhase = phasesArr[idx];
    const currentKey = phaseKeyOf(currentPhase);
    const myDone = phaseStatuses.get(currentKey)?.done || 0;

    const canStartQty = Math.max(0, prevDone - myDone);
    return canStartQty > 0;
  };

  /* ---------------------------------------------------------
     MATERIAL / FRAME INFO
  --------------------------------------------------------- */
  useEffect(() => {
    if (!sheet) {
      setMaterialInfo(null);
      setFrameInfo(null);
      return;
    }

    const hasPhase2or30 = (sheet.product?.phases ?? []).some((p: any) => ["2", "30"].includes(String(p.phaseId)));

    if (!hasPhase2or30) {
      setMaterialInfo(null);
      return;
    }

    // consider "completed" if sum of done for phaseId 2 or 30 (any position) >= sheet.quantity
    const sumDoneForPhaseId = (pid: string) =>
      Array.from(phaseStatuses.entries())
        .filter(([k]) => String(k).startsWith(`${pid}@`))
        .reduce((acc, [, v]) => acc + (v?.done || 0), 0);

    const done2 = sumDoneForPhaseId("2");
    const done30 = sumDoneForPhaseId("30");
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

        const filtered = resolveMaterialsForPhase(sheet, freshMaterials);
        setMaterialInfo(filtered.length ? filtered : null);
      } catch (e) {
        console.error("material info refresh failed:", e);
      }
    })();

    // FRAME INFO (PHASE 21)
    const hasPhase21 = (sheet.product?.phases ?? []).some((p: any) => String(p.phaseId) === "21");

    if (!hasPhase21) {
      setFrameInfo(null);
    } else {
      const done21 = Array.from(phaseStatuses.entries())
        .filter(([k]) => String(k).startsWith(`21@`))
        .reduce((acc, [, v]) => acc + (v?.done || 0), 0);

      const phase21Completed = done21 >= sheet.quantity;
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
  }, [sheet, phaseStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------
     FINISH PREVIOUS PHASE DIALOG
  --------------------------------------------------------- */
  const ensurePreviousPhaseClosed = async () => {
    if (activeDeadTime) {
      await openModal(
        t("machineOperator.modals.deadTimeRunningTitle"),
        t("machineOperator.modals.deadTimeRunningMessage"),
        [{ label: t("common.ok"), type: "primary", onClick: () => closeModal(false) }]
      );
      return false;
    }

    if (!activeLog) return true;

    const runningStage = (activeLog as any).stage as StageType | undefined;

    const stageLabel =
      runningStage === "find"
        ? t("machineOperator.stages.find")
        : runningStage === "setup"
        ? t("machineOperator.stages.setup")
        : t("machineOperator.stages.production");

    const confirm = await openModal(
      t("machineOperator.modals.stageStillRunningTitle", { stage: stageLabel }),
      t("machineOperator.modals.stageStillRunningMessage", { stage: stageLabel }),
      [
        { label: t("machineOperator.buttons.finishIt"), type: "primary", onClick: () => closeModal(true) },
        { label: t("common.cancel"), type: "secondary", onClick: () => closeModal(false) },
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
  const startSimpleStage = async (phaseId: string, stage: StageType, position: string) => {
    if (stage === "production") return;
    if (!sheet || !user?.username) return;

    const remainingForPhase = computeRemainingForPhase(phaseId, position);
    if (remainingForPhase <= 0) return alert(t("machineOperator.alerts.nothingToStart"));

    setIsLoading(true);
    setError(null);

    try {
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        position,
        startTime: new Date().toISOString(),
        totalQuantity: 0,
        stage,
      });

      setActiveLog(mapPhaseLog(newLog));

      const def: any = sheet.product?.phases?.find(
        (p: any) => String(p.phaseId) === String(phaseId) && String(p.position) === String(position)
      );

      const plannedTime = (def?.setupTime || 0) + (def?.productionTimePerPiece || 0) * remainingForPhase;

      await api.startLivePhase({
        username: user.username,
        sheetId: sheet.id,
        productId: sheet.productId,
        phaseId,
        position,
        plannedTime,
        status: stage === "find" ? "search" : "setup",
      });

      setCurrentStage(stage);
      setCurrentStagePhaseId(phaseId);
      setStageSeconds(0);

      clearStageTimer();
      stageTimerRef.current = window.setInterval(() => setStageSeconds((s) => s + 1), 1000);

      // keep UI consistent
      await refreshCurrentSheet(sheet.qrValue);
    } catch (e) {
      console.error("startSimpleStage error:", e);
      setError((e as Error).message);
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

    const seconds = stageSeconds;
    const logId = activeLog?.id;

    setIsLoading(true);
    try {
      if (!logId) throw new Error(t("machineOperator.errors.noActiveLogToFinish"));

      await api.finishPhase(logId, new Date().toISOString(), 0, seconds);

      if (user?.username) {
        await api.stopLivePhase(user.username);
      }

      setActiveLog(null);

      // refresh to reflect finished state
      await refreshCurrentSheet();
    } catch (e) {
      console.error("finishSimpleStage error:", e);
      setError((e as Error).message);
    } finally {
      setStageSeconds(0);
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setIsLoading(false);
    }
  };

  /* ---------------------------------------------------------
     START PRODUCTION (REFRESH AFTER START)
  --------------------------------------------------------- */
  const startProductionStage = async (phaseId: string, position: string) => {
    const ok = await ensurePreviousPhaseClosed();
    if (!ok) return;
    if (!sheet || !user) return;

    const remainingForPhase = computeRemainingForPhase(phaseId, position);
    if (remainingForPhase <= 0) return alert(t("machineOperator.alerts.nothingToStart"));

    const times = pendingStageTimes[phaseId] || { find: 0, setup: 0 };
    setIsLoading(true);
    setError(null);

    try {
      const newLog = await api.startPhase({
        operatorUsername: user.username,
        orderNumber: sheet.orderNumber,
        productionSheetNumber: sheet.productionSheetNumber,
        productId: sheet.productId,
        phaseId,
        position,
        startTime: new Date().toISOString(),
        totalQuantity: remainingForPhase,
        findMaterialTime: times.find || 0,
        setupTime: times.setup || 0,
        stage: "production",
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
          (p: any) => String(p.phaseId) === String(phaseId) && String(p.position) === String(position)
        );
        if (def) {
          const planned = (def.productionTimePerPiece || 0) * remainingForPhase;

          await api.startLivePhase({
            username: user.username,
            sheetId: sheet.id,
            productId: sheet.productId,
            phaseId,
            position,
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

      stageTimerRef.current = window.setInterval(() => setStageSeconds((s) => s + 1), 1000);

      // ✅ REQUIRED: refresh from backend so "In progress by..." + completion buttons appear
      await refreshCurrentSheet(sheet.qrValue);
    } catch (e) {
      console.error("startProductionStage error:", e);
      setError((e as Error).message);
      clearStageTimer();
      setCurrentStage(null);
      setCurrentStagePhaseId(null);
      setStageSeconds(0);
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
    const position = String(activeLog.position);
    const remaining = computeRemainingForPhase(phaseId, position);

    if (remaining <= 0) {
      alert(t("machineOperator.alerts.nothingRemainingToFinish"));
      return;
    }

    let quantityDone = remaining;

    if (isPartial) {
      const qtyStr = prompt(t("machineOperator.prompts.enterQuantity", { remaining }));
      if (qtyStr === null) return;

      const qty = parseInt(qtyStr.trim(), 10);
      if (!Number.isFinite(qty) || qty <= 0 || qty > remaining) {
        alert(t("machineOperator.alerts.invalidQuantity"));
        return;
      }
      quantityDone = qty;
    }

    clearStageTimer();
    const productionSeconds = stageSeconds;

    const finishedPhaseId = phaseId;
    const shouldAskConsume = ["2", "30"].includes(finishedPhaseId) && quantityDone > 0;

    let updatedSheet: ProductionSheetForOperator | null = null;

    setIsLoading(true);
    try {
      await api.finishPhase(activeLog.id, new Date().toISOString(), quantityDone, productionSeconds);

      if (user) {
        api.stopLivePhase(user.username).catch((e) => console.error("finishProductionStage stop live error:", e));
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
      return;
    } finally {
      setIsLoading(false);
    }

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

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const freshMaterials = await api.getMaterials();
    const candidates = resolveMaterialsForPhase(updatedSheet ?? sheet, freshMaterials);

    if (!candidates.length) {
      await openModal(
        t("machineOperator.noMaterialsTitle"),
        t("machineOperator.noMaterialsMessage"),
        [{ label: t("common.ok"), type: "primary", onClick: () => closeModal(false) }]
      );
      return;
    }

    setConsumeAction(null);
    setConsumeFlow({
      open: true,
      phaseId: finishedPhaseId,
      quantityDone,
      candidates,
      selectedMaterial: null,
    });

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
     RECURRING CONSUMPTION HANDLER
  --------------------------------------------------------- */
  const handleConsumeSuccess = async () => {
    // 1. Close the modal briefly so the confirmation dialog can appear cleanly
    setConsumeFlow((prev) => ({ ...prev, open: false }));

    // 2. Ask the user if they want to consume more
    const wantMore = await openModal(
      t("machineOperator.consumeMoreTitle") || "Consume More?",
      t("machineOperator.consumeMoreMessage") || "Do you want to consume another material?",
      [
        { label: t("common.yes"), type: "primary", onClick: () => closeModal(true) },
        { label: t("common.no"), type: "secondary", onClick: () => closeModal(false) },
      ]
    );

    if (wantMore) {
      setIsLoading(true);
      try {
        // 3. Refresh materials to get updated quantities (ensure we don't pick empty stock)
        const freshMaterials = await api.getMaterials();
        // Use the safe resolver from your helpers
        const candidates = resolveMaterialsForPhase(sheet, freshMaterials);
        
        // Update the UI list
        setMaterialInfo(candidates.length ? candidates : null);

        if (candidates.length === 0) {
           await openModal(
             t("machineOperator.noMaterialsTitle"), 
             t("machineOperator.noMaterialsMessage"), 
             [{ label: t("common.ok"), type: "primary", onClick: () => closeModal(false) }]
           );
           return;
        }

        // 4. Re-open the flow, clearing the selection for the next item
        setConsumeFlow((prev) => ({
          ...prev,
          open: true,
          candidates: candidates,
          selectedMaterial: null, 
        }));
      } catch (e) {
        console.error("Error refreshing materials:", e);
      } finally {
        setIsLoading(false);
      }
    } else {
      // User is done, keep flow closed
      setConsumeFlow((prev) => ({ ...prev, open: false }));
    }
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
            <div className="bg-white rounded-lg shadow-xl px-6 py-4">{t("common.loading")}</div>
          </div>
        )}
        <div className="max-w-xl mx-auto">
          <Scanner onScanSuccess={handleScanSuccess} onScanError={(msg) => setError(msg)} />
          <button onClick={() => setViewState("idle")} className="mt-4 w-full bg-gray-500 text-white py-2 rounded-md">
            {t("common.cancel")}
          </button>

          {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
        </div>
      </>
    );

  /* ---------------------------------------------------------
    BLOCK IF DEAD TIME or MULTI-JOB IS ACTIVE
  --------------------------------------------------------- */
  if (activeDeadTime) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">{t("machineOperator.deadTime.activeTitle")}</h2>
        <p className="mb-2">
          <strong>{t("machineOperator.deadTime.codeLabel")}:</strong> {activeDeadTime.code}
        </p>
        <p className="text-sm text-gray-600 mb-4">{t("machineOperator.deadTime.blockMessage")}</p>
      </div>
    );
  }

  if (activeMultiJob) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">
          {t("machineOperator.multiJob.activeTitle")}
        </h2>

        <p className="text-sm text-gray-600 mb-4">
          {t("machineOperator.multiJob.blockMessage")}
        </p>

        <button
          className="w-full bg-gray-500 text-white py-2 rounded-md"
          onClick={() => {
            setActiveMultiJob(null);
            setError(null);
            setViewState("idle");
          }}
        >
          {t("common.ok")}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------
     DETAILS GUARDS
  --------------------------------------------------------- */
  if (viewState === "details") {
    if (!sheet) return <div style={{ padding: 20 }}>{t("machineOperator.errors.noSheetLoaded")}</div>;

    if (!sheet.product || !Array.isArray(sheet.product.phases))
      return (
        <div style={{ padding: 20 }}>
          {t("machineOperator.errors.invalidSheetStructure")}
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
            <div className="bg-white rounded-lg shadow-xl px-6 py-4">{t("common.loading")}</div>
          </div>
        )}
        <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">{t("machineOperator.sheetDetails")}</h2>

          {/* SHEET INFO */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-md">
            <p>
              <strong>{t("machineOperator.orderNum")}:</strong> {sheet.orderNumber}
            </p>
            <p>
              <strong>{t("machineOperator.sheetNum")}:</strong> {sheet.productionSheetNumber}
            </p>
            <p>
              <strong>{t("machineOperator.product")}:</strong> {sheet.productId}
            </p>
            <p>
              <strong>{t("machineOperator.qty")}:</strong> {sheet.quantity}
            </p>
          </div>

          {/* MATERIAL INFO */}
          {Array.isArray(materialInfo) && materialInfo.length > 0 && (
            <div className="p-4 my-4 border rounded-md bg-indigo-50">
              <h4 className="font-semibold mb-2">{t("machineOperator.materialInfo")}</h4>

              <div className="space-y-3">
                {materialInfo.map((mat) => (
                  <div key={mat.id} className="p-3 bg-white border rounded-md">
                    <p>
                      <strong>{t("common.material")}:</strong> {mat.materialCode}
                    </p>
                    <p>
                      <strong>{t("common.quantity")}:</strong> {mat.currentQuantity} / {mat.initialQuantity}
                    </p>
                    <p>
                      <strong>{t("common.location")}:</strong>{" "}
                      {mat.location
                        ? `${mat.location.area}, ${t("common.position")} ${mat.location.position}`
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
              <h4 className="font-semibold mb-2">{t("machineOperator.frameInfo")}</h4>

              <div className="space-y-3">
                {frameInfo.map((f) => (
                  <div key={f.frameId} className="p-3 bg-white border rounded-md">
                    <p>
                      <strong>{t("machineOperator.frame.fields.frame")}:</strong> {t("machineOperator.frame.framePrefix")}{" "}
                      {f.frameId}
                    </p>
                    <p>
                      <strong>{t("machineOperator.frame.fields.position")}:</strong> {f.position ?? t("common.na")}
                    </p>
                    <p>
                      <strong>{t("machineOperator.frame.fields.quality")}:</strong> {f.quality ?? t("common.na")}
                    </p>
                    <p>
                      <strong>{t("machineOperator.frame.fields.size")}:</strong>{" "}
                      {f.widthCm && f.heightCm ? `${f.widthCm} × ${f.heightCm} cm` : t("common.na")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONSUME FLOW: SELECT MATERIAL */}
          {consumeFlow.open && !consumeFlow.selectedMaterial && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
                <div className="p-5 border-b flex justify-between items-center">
                  <h4 className="text-xl font-semibold text-gray-800">{t("machineOperator.selectMaterialTitle")}</h4>

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
                    aria-label={t("common.close")}
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
                        onClick={() => setConsumeFlow((prev) => ({ ...prev, selectedMaterial: m }))}
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <div className="font-mono">{m.materialCode}</div>
                            <div className="text-xs text-gray-600">
                              {m.location
                                ? `${m.location.area}, ${t("common.position")} ${m.location.position}`
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
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CONSUME FLOW: CHOOSE ACTION */}
          {consumeFlow.open && consumeFlow.selectedMaterial && !consumeAction && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-5 border-b flex justify-between items-center">
                  <h4 className="text-xl font-semibold text-gray-800">{t("machineOperator.consumeActionTitle")}</h4>

                  <button
                    onClick={() => {
                      setConsumeAction(null);
                      setConsumeFlow((prev) => ({ ...prev, selectedMaterial: null }));
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    aria-label={t("common.close")}
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
                      <strong>{t("common.quantity")}:</strong> {consumeFlow.selectedMaterial.currentQuantity} /{" "}
                      {consumeFlow.selectedMaterial.initialQuantity}
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
                        setConsumeAction(null);
                        setConsumeFlow((prev) => ({ ...prev, selectedMaterial: null }));
                      }}
                    >
                      {t("common.back")}
                    </button>

                    <button
                      type="button"
                      className="w-1/2 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
                      onClick={() => {
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
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CONSUME FLOW: ACTION MODAL COMPONENT */}
          {consumeAction && consumeFlow.selectedMaterial && (
            <ActionModal
              actionType={consumeAction}
              material={consumeFlow.selectedMaterial}
              initialProductionCode={buildProductionCode(sheet)}
              onClose={() => setConsumeAction(null)}
              onComplete={async () => {
                setConsumeAction(null);
                

                // Refresh materials after consumption
                const freshMaterials = await api.getMaterials();
                setMaterialInfo(resolveMaterialsForPhase(sheet, freshMaterials));
                await handleConsumeSuccess();
                // Optionally refresh the sheet status
                // reloadSheet(); 
              }}
            />
          )}

          {/* PHASES */}
          <h3 className="text-xl font-semibold mb-2">{t("machineOperator.phases")}</h3>

          <div className="space-y-3">
            {sortedPhases.map((phase: any, index: number) => {
              const phaseKey = phaseKeyOf(phase);
              const status = phaseStatuses.get(phaseKey) || {
                done: 0,
                total: sheet.quantity,
                inProgress: false,
              };

              const isUnlocked =
                index === 0 || (phaseStatuses.get(phaseKeyOf(sortedPhases[index - 1]))?.done || 0) > 0;

              const prevDone =
                index === 0 ? sheet.quantity : phaseStatuses.get(phaseKeyOf(sortedPhases[index - 1]))?.done || 0;

              const canStartQty = Math.max(0, prevDone - status.done);

              const hasSetup =
                (sheet.product.phases.find((p: any) => String(p.phaseId) === phase.phaseId)?.setupTime || 0) > 0;

              const isPhaseLocked = canStartQty <= 0;

              const isMyCurrentPhase = currentStagePhaseId === phase.phaseId && currentStage !== null;
              const isRunningFind = isMyCurrentPhase && currentStage === "find";
              const isRunningSetup = isMyCurrentPhase && currentStage === "setup";
              const isRunningProduction = isMyCurrentPhase && currentStage === "production";

              const isInProgress = logs.some((l) => !l.endTime && phaseKeyOf(l) === phaseKeyOf(phase));

              return (
                <div  key={phaseKey} className="p-3 border rounded-md bg-white flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                  {/* LEFT */}
                  <div>
                    <p className="font-bold text-lg">
                      {phases.find((p) => String(p.id) === phase.phaseId)?.name ||
                        t("machineOperator.phaseFallback", { id: phase.phaseId })}
                    </p>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        {t("machineOperator.status")}{" "}
                        <span className="font-semibold">
                          {status.done} / {sheet.quantity}
                        </span>
                      </p>

                      {isInProgress && (
                        <p className="text-yellow-600">
                          🟡 {t("machineOperator.inProgressBy")}{" "}
                          {logs
                            .filter((l) => !l.endTime && phaseKeyOf(l) === phaseKeyOf(phase))
                            .map((l) => l.operatorUsername)
                            .join(", ")}
                        </p>
                      )}

                      {(() => {
                        const matchingFinishedLogs = (sheet?.phaseLogs || []).filter(
                          (l) => l.endTime && phaseKeyOf(l) === phaseKeyOf(phase) && (l.quantityDone || 0) > 0
                        );

                        if (matchingFinishedLogs.length > 0) {
                          return (
                            <p className="text-green-700 text-sm mt-1">
                              ✅ {t("machineOperator.quantityDone")}{" "}
                              {matchingFinishedLogs
                                .map((l) => `${l.operatorUsername} (${l.quantityDone})`)
                                .join(", ")}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>

                  {/* RIGHT */}
                  <div className="w-full sm:w-auto flex flex-col gap-2 items-stretch sm:items-end">
                    {(isRunningFind || isRunningSetup) && !isPhaseLocked && (
                      <div className="flex flex-col items-end gap-1">
                        <button onClick={finishSimpleStage} className="btn-secondary">
                          {t("machineOperator.finish")}
                        </button>
                      </div>
                    )}

                    {isRunningProduction && !isPhaseLocked && isInProgress && (
                      <div className="flex flex-col items-end gap-1">
                        <div className="w-full sm:w-auto grid grid-cols-2 gap-2">
                          <button onClick={() => finishProductionStage(true)} className="btn-secondary">
                            {t("machineOperator.finishPartial")}
                          </button>
                          <button onClick={() => finishProductionStage(false)} className="btn-primary">
                            {t("machineOperator.finishFull")}
                          </button>
                        </div>
                      </div>
                    )}

                    {!currentStage && !isPhaseLocked && isUnlocked && (
                      <div className="flex flex-col items-end gap-2">
                        {(phase.phaseId === "2" || phase.phaseId === "30") && (
                          <button
                            onClick={() => startSimpleStage(phase.phaseId, "find", phase.position)}
                            className="btn-secondary"
                          >
                            {t("machineOperator.buttons.findMaterial")}
                          </button>
                        )}

                        {hasSetup && (
                          <button
                            onClick={() => startSimpleStage(phase.phaseId, "setup", phase.position)}
                            className="btn-secondary"
                          >
                            {t("machineOperator.buttons.startSetup")}
                          </button>
                        )}

                        <button onClick={() => startProductionStage(phase.phaseId, phase.position)} className="btn-primary">
                          {t("machineOperator.buttons.startProduction")}
                        </button>
                      </div>
                    )}

                    {currentStage && !isMyCurrentPhase && (
                      <p className="text-xs text-gray-400">{t("machineOperator.busyAnotherPhase")}</p>
                    )}

                    {isPhaseLocked && <p className="text-xs text-gray-400">{t("machineOperator.phaseLocked")}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* BOTTOM */}
          <button onClick={resetView} className="mt-6 w-full text-indigo-600 hover:underline">
            {t("operator.scanAnother")}
          </button>

          <style>{`
            .btn-primary, .btn-secondary{
              width: 100%;
              box-sizing: border-box;
              padding: .5rem 1rem;
              border-radius: 6px;
              font-weight: 500;
              white-space: normal; /* allow wrapping on small screens */
              word-break: break-word;
            }
            .btn-primary{
              background:#4F46E5;
              color:#fff;
            }
            .btn-secondary{
              background:#E5E7EB;
              color:#374151;
            }
            @media (min-width: 640px){
              .btn-primary, .btn-secondary{
                width: auto;
              }
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
          <div className="bg-white rounded-lg shadow-xl px-6 py-4">{t("common.loading")}</div>
        </div>
      )}
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">{t("machineOperator.title")}</h2>
        <p className="text-gray-600 mb-6">{t("machineOperator.scanPrompt")}</p>

        <button
          onClick={async () => {
            if (!user?.username) return;

            try {
              const status = await api.getLiveStatus();

              const myDead = (status.dead || []).find((d: any) => d.username === user.username);
              if (myDead) {
                setActiveDeadTime(myDead);
                return;
              }

              const myMulti = (status.active || []).find(
                (x: any) => x.username === user.username && String(x.status || "") === "multi"
              );
              if (myMulti) {
                setActiveMultiJob(myMulti);
                return;
              }

              setViewState("scanning");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          className="w-full bg-indigo-600 text-white py-3 rounded-md"
        >
          {t("machineOperator.startScan")}
        </button>

        {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
      </div>
    </>
  );
};

export default MachineOperatorView;
