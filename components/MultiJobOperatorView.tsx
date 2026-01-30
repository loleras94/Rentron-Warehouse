import React, { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "../hooks/useTranslation";
import Scanner from "./Scanner";
import ConfirmModal from "../components/ConfirmModal";
import { mapPhaseLog } from "../src/mapPhaseLog";
import type { ProductionSheetForOperator, Phase } from "../src/types";

type StageType = "production";

/* ---------------------------------------------------------
   Blocker for Active Job or Dead Time
--------------------------------------------------------- */

type BlockedDeadTime = {
  id?: string;
  code: number;
  description?: string;
  productId?: string;
  orderNumber?: string;
  productionSheetNumber?: string;
  runningSeconds?: number;
};

type BlockedPhase = {
  sheetId?: string;
  productionSheetNumber?: string;
  productId?: string;
  phaseId?: string;
  runningSeconds?: number;
  status?: string; // production/search/setup etc
};

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

/* ---------------------------------------------------------
   Helpers: productionPosition + deleted phases
--------------------------------------------------------- */

const posStr = (v: any) => String(v ?? "");
const posNum = (v: any) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

const phasePosOf = (x: any) =>
  Number(x?.productionPosition ?? x?.production_position ?? x?.position ?? 0);

const isDeletedPhase = (p: any) =>
  Boolean(
    p?.deleted === true ||
      p?.isDeleted === true ||
      p?.is_deleted === true ||
      p?.deletedAt ||
      p?.deleted_at
  );

const parseMaybeDateMs = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;

  const s = String(v).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n;
  }

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
};

const phaseKeyOf = (p: any) => `${String(p.phaseId)}@${String(phasePosOf(p) || "")}`;

const normalizeProductPhases = (rawProduct: any | null | undefined) => {
  if (!rawProduct) return { ...rawProduct, phases: [] as any[] };
  const phasesArr = Array.isArray(rawProduct.phases) ? rawProduct.phases : [];
  const normalizedPhases = phasesArr.map((p: any) => ({
    ...p,
    phaseId: String(p.phaseId ?? p.phase_id ?? p.id),
    productionPosition: phasePosOf(p),
  }));
  return { ...rawProduct, phases: normalizedPhases };
};

const normalizeSheet = (raw: any): ProductionSheetForOperator => {
  const product = normalizeProductPhases(raw.product || null);
  const rawLogs = Array.isArray(raw.phaseLogs) ? raw.phaseLogs : raw.phase_logs || [];
  const phaseLogs = rawLogs.map(mapPhaseLog);
  return { ...raw, phaseLogs, product };
};

function splitSecondsProportionally(totalSeconds: number, weights: number[]) {
  const n = weights.length;
  if (n === 0) return [];
  if (totalSeconds <= 0) return new Array(n).fill(0);

  const sumW = weights.reduce(
    (a, b) => a + (Number.isFinite(b) ? Math.max(0, b) : 0),
    0
  );
  const safeWeights = sumW > 0 ? weights.map((w) => Math.max(0, w)) : new Array(n).fill(1);

  const sumSafe = safeWeights.reduce((a, b) => a + b, 0);
  const exact = safeWeights.map((w) => (totalSeconds * w) / sumSafe);

  const base = exact.map((x) => Math.floor(x));
  let used = base.reduce((a, b) => a + b, 0);
  let remaining = totalSeconds - used;

  const remainders = exact.map((x, i) => ({ i, r: x - base[i] })).sort((a, b) => b.r - a.r);

  for (let k = 0; k < remainders.length && remaining > 0; k++) {
    base[remainders[k].i] += 1;
    remaining -= 1;
  }
  return base;
}

type ViewState = "idle" | "scanning" | "pickPhase" | "build" | "running" | "saving";

type JobItem = {
  id: string;
  qrValue: string;
  sheet: ProductionSheetForOperator;
  phaseId: string;
  position: string;
  stage: StageType;
};

type StoredJobItem = {
  qrValue: string;
  phaseId: string;
  position: string;
  stage: StageType;
};

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/* ---------------------------------------------------------
   DB persistence ONLY (no LocalStorage)
--------------------------------------------------------- */

const loadStoredJobsServer = async (): Promise<StoredJobItem[] | null> => {
  const res: any = await api.getMyMultiSession();
  const items = Array.isArray(res?.items) ? res.items : null;
  if (!items) return null;
  return items.map((x: any) => ({
    qrValue: String(x.qrValue),
    phaseId: String(x.phaseId),
    position: posStr(x.position),
    stage: (x.stage as StageType) || "production",
  }));
};

const saveStoredJobsServer = async (username: string, items: StoredJobItem[]) => {
  await api.saveMultiSession({
    username,
    items: items.map((it) => ({
      qrValue: it.qrValue,
      phaseId: it.phaseId,
      position: it.position,
      stage: it.stage,
    })),
  });
};

const clearStoredJobsServer = async () => {
  await api.clearMyMultiSession();
};

/* ---------------------------------------------------------
   Unlock next phase on same sheet scan
--------------------------------------------------------- */

const jobKey = (sheetId: any, phaseId: any, pos: any) =>
  `${String(sheetId)}|${String(phaseId)}|${String(posNum(pos))}`;

const getUnlockInfoForSheet = (
  sheet: ProductionSheetForOperator,
  ctxJobs: Array<Pick<JobItem, "sheet" | "phaseId" | "position">> = []
) => {
  const phasesArr = [...(sheet.product?.phases ?? [])]
    .filter((p: any) => !isDeletedPhase(p))
    .sort((a: any, b: any) => phasePosOf(a) - phasePosOf(b));

  const jobsOnSheet = ctxJobs.filter((j) => String(j.sheet?.id) === String(sheet.id));

  const selectedKeys = new Set<string>();
  let maxSelectedPos: number | null = null;

  for (const j of jobsOnSheet) {
    selectedKeys.add(jobKey(sheet.id, j.phaseId, j.position));
    const p = posNum(j.position);
    if (Number.isFinite(p)) maxSelectedPos = maxSelectedPos === null ? p : Math.max(maxSelectedPos, p);
  }

  let nextPos: number | null = null;
  if (maxSelectedPos !== null) {
    for (const ph of phasesArr) {
      const p = phasePosOf(ph);
      if (p > maxSelectedPos) {
        nextPos = p;
        break;
      }
    }
  }

  return { phasesArr, selectedKeys, nextPos };
};

const MultiJobOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [phasesDef, setPhasesDef] = useState<Phase[]>([]);
  useEffect(() => {
    api.getPhases().then(setPhasesDef).catch(console.error);
  }, []);

  // modal
  const modalResolverRef = useRef<((v: boolean) => void) | null>(null);
  const [modalData, setModalData] = useState<{
    open: boolean;
    title: string;
    message: string;
    buttons: any[];
  }>({ open: false, title: "", message: "", buttons: [] });

  const openModal = (title: string, message: string, buttons: any[]) =>
    new Promise<boolean>((resolve) => {
      modalResolverRef.current = resolve;
      setModalData({ open: true, title, message, buttons });
    });

  const closeModal = (value: boolean) => {
    const r = modalResolverRef.current;
    modalResolverRef.current = null;
    r?.(value);
    setModalData((m) => ({ ...m, open: false }));
  };

  const [view, setView] = useState<ViewState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [pendingSheet, setPendingSheet] = useState<ProductionSheetForOperator | null>(null);
  const [pendingQr, setPendingQr] = useState<string>("");

  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [seconds, setSeconds] = useState(0);

  const [blockedDead, setBlockedDead] = useState<BlockedDeadTime | null>(null);
  const [blockedPhase, setBlockedPhase] = useState<BlockedPhase | null>(null);

  const startTsRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const clockSkewMsRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => clearTimer(), []);

  const startTickingFromStart = (startMs: number) => {
    startTsRef.current = startMs;

    const refresh = () => {
      const now = Date.now() + (clockSkewMsRef.current || 0);
      const s = Math.max(0, Math.floor((now - startMs) / 1000));
      setSeconds(s);
    };

    refresh();
    clearTimer();
    timerRef.current = window.setInterval(refresh, 1000);
  };

  // Blocker check
  useEffect(() => {
    if (!user?.username) return;

    // don't interrupt a running multi session UI
    if (view === "running" || view === "saving") return;

    let cancelled = false;

    (async () => {
      try {
        const status = await api.getLiveStatus();
        if (cancelled) return;

        // 1) dead time blocks everything
        const myDead = (status.dead || []).find((d: any) => d.username === user.username);
        if (myDead) {
          setBlockedDead({
            id: myDead.id,
            code: Number(myDead.code),
            description: myDead.description,
            productId: myDead.productId,
            orderNumber: myDead.orderNumber,
            productionSheetNumber: myDead.productionSheetNumber,
            runningSeconds: Number(myDead.runningSeconds || 0),
          });
          setBlockedPhase(null);
          setError(null);
          setView("idle");
          return;
        }

        // 2) any non-multi live session blocks multi-job
        const myLive = (status.active || []).find((x: any) => x.username === user.username);
        if (myLive && String(myLive.status || "") !== "multi") {
          setBlockedPhase({
            sheetId: myLive.sheetId,
            productionSheetNumber: myLive.productionSheetNumber,
            productId: myLive.productId,
            phaseId: String(myLive.phaseId ?? ""),
            runningSeconds: Number(myLive.runningSeconds || 0),
            status: String(myLive.status || ""),
          });
          setBlockedDead(null);
          setError(null);
          setView("idle");
          return;
        }

        // 3) backend says single phase active (extra safety)
        const res = await api.getMyActivePhase();
        if (cancelled) return;

        if (res?.active) {
          setBlockedPhase({
            sheetId: String(res.active.sheet_id ?? res.active.sheetId ?? ""),
            productionSheetNumber: String(
              res.active.production_sheet_number ?? res.active.productionSheetNumber ?? ""
            ),
            productId: String(res.active.product_id ?? res.active.productId ?? ""),
            phaseId: String(res.active.phase_id ?? res.active.phaseId ?? ""),
            runningSeconds: Number(res.active.running_seconds ?? res.active.runningSeconds ?? 0),
            status: "production",
          });
          setBlockedDead(null);
          setError(null);
          setView("idle");
          return;
        }

        // ok to use multi-job
        setBlockedDead(null);
        setBlockedPhase(null);

        // guard against view/pending mismatch
        setView((v) => {
          if (v === "pickPhase" && !pendingSheet) return jobs.length ? "build" : "idle";
          return v;
        });
      } catch (e) {
        console.error("multi-job blocker check failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username, view]);

  // keep timer accurate on focus/visibility
  useEffect(() => {
    const recompute = () => {
      if (!startTsRef.current) return;
      const startMs = startTsRef.current;
      const now = Date.now() + (clockSkewMsRef.current || 0);
      const s = Math.max(0, Math.floor((now - startMs) / 1000));
      setSeconds(s);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") recompute();
    };
    const onFocus = () => recompute();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // resume existing multi live session (DB-only)
  useEffect(() => {
    if (!user?.username) return;

    let cancelled = false;

    const resume = async () => {
      try {
        if (view === "running") return;

        const status = await api.getLiveStatus();
        if (cancelled) return;

        const myDead = (status.dead || []).find((d: any) => d.username === user.username);
        if (myDead) {
          setError(t("multiJob.errors.deadTimeActive"));
          return;
        }

        const myLive = (status.active || []).find((x: any) => x.username === user.username);
        if (!myLive || String(myLive.status || "") !== "multi") return;

        let stored: StoredJobItem[] | null = null;
        try {
          stored = await loadStoredJobsServer();
        } catch (e) {
          console.error("Failed to load multi session from server:", e);
          stored = null;
        }

        if (!stored || stored.length < 2) {
          const doStop = await openModal(
            t("multiJob.modal.foundTitle"),
            t("multiJob.modal.noSavedListMessage"),
            [
              {
                label: t("multiJob.modal.stopLiveSession"),
                type: "primary",
                onClick: () => closeModal(true),
              },
              {
                label: t("multiJob.modal.keepRunning"),
                type: "secondary",
                onClick: () => closeModal(false),
              },
            ]
          );

          if (!doStop) return;

          await api.stopLivePhase(user.username).catch(() => {});
          await clearStoredJobsServer().catch(() => {});
          setError(t("multiJob.errors.stoppedNoRestore"));
          setView("idle");
          return;
        }

        setView("saving");

        const hydrated: JobItem[] = [];
        for (const it of stored) {
          const raw = await api.getProductionSheetByQr(it.qrValue);
          const sheet = normalizeSheet(raw);
          hydrated.push({
            id: uid(),
            qrValue: it.qrValue,
            sheet,
            phaseId: it.phaseId,
            position: it.position,
            stage: it.stage || "production",
          });
        }

        if (cancelled) return;
        setJobs(hydrated);

        const startFromBackend =
          parseMaybeDateMs((myLive as any)?.start_time) ?? parseMaybeDateMs((myLive as any)?.startTime);

        const serverNowMs =
          parseMaybeDateMs((myLive as any)?.server_now) ?? parseMaybeDateMs((status as any)?.server_now);

        if (serverNowMs) clockSkewMsRef.current = serverNowMs - Date.now();

        const runningSeconds =
          Number((myLive as any)?.runningSeconds ?? (myLive as any)?.running_seconds ?? 0) || 0;

        const startMs =
          startFromBackend ??
          (serverNowMs ? serverNowMs - runningSeconds * 1000 : Date.now() - runningSeconds * 1000);

        startTickingFromStart(startMs);

        setView("running");
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setView("idle");
        setError((e as Error).message);
      }
    };

    resume();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  // DB-only autosave
  useEffect(() => {
    if (!user?.username) return;
    if (view !== "build" && view !== "running") return;

    const items: StoredJobItem[] = jobs.map((j) => ({
      qrValue: j.qrValue,
      phaseId: String(j.phaseId),
      position: posStr(j.position),
      stage: j.stage,
    }));

    if (items.length <= 0) return;

    const handle = window.setTimeout(() => {
      saveStoredJobsServer(user.username, items).catch((e) => {
        console.error("Failed to save multi session to server:", e);
        setError((prev) => prev ?? "Could not save multi-session to server. Check connection.");
      });
    }, 200);

    return () => window.clearTimeout(handle);
  }, [jobs, view, user?.username]);

  const computeRemainingForPhase = (
    sheet: ProductionSheetForOperator,
    phaseId: string,
    productionPosition: string | number,
    ctxJobs: Array<Pick<JobItem, "sheet" | "phaseId" | "position">> = []
  ) => {
    const { phasesArr, selectedKeys, nextPos } = getUnlockInfoForSheet(sheet, ctxJobs);
    const logs = sheet.phaseLogs ?? [];
    const pp = posNum(productionPosition);

    const phaseObj = phasesArr.find(
      (p: any) => String(p.phaseId) === String(phaseId) && phasePosOf(p) === pp
    );
    if (!phaseObj) return 0;

    const doneByPhase = new Map<string, number>();
    phasesArr.forEach((p: any) => doneByPhase.set(phaseKeyOf(p), 0));

    logs.forEach((log: any) => {
      const key = phaseKeyOf(log);
      doneByPhase.set(key, (doneByPhase.get(key) || 0) + (log.quantityDone || 0));
    });

    const idx = phasesArr.indexOf(phaseObj);
    if (idx < 0) return 0;

    const alreadyDoneHere = doneByPhase.get(phaseKeyOf(phaseObj)) || 0;

    const upstreamDone =
      idx === 0 ? sheet.quantity : doneByPhase.get(phaseKeyOf(phasesArr[idx - 1])) || 0;

    const strictRemaining = Math.max(0, upstreamDone - alreadyDoneHere);
    if (strictRemaining > 0) return strictRemaining;

    const key = jobKey(sheet.id, phaseId, pp);
    const isAlreadySelected = selectedKeys.has(key);
    const isNextUnlocked = nextPos !== null && pp === nextPos;

    if (isAlreadySelected || isNextUnlocked) {
      return Math.max(0, Number(sheet.quantity || 0) - alreadyDoneHere);
    }

    return 0;
  };

  const computePlannedMinutes = (
    sheet: ProductionSheetForOperator,
    phaseId: string,
    productionPosition: string | number,
    ctxJobs: Array<Pick<JobItem, "sheet" | "phaseId" | "position">> = []
  ) => {
    const pp = posNum(productionPosition);
    const def: any = (sheet.product?.phases ?? [])
      .filter((p: any) => !isDeletedPhase(p))
      .find((p: any) => String(p.phaseId) === String(phaseId) && phasePosOf(p) === pp);

    const remaining = computeRemainingForPhase(sheet, phaseId, pp, ctxJobs);

    const setupMin = Number(def?.setupTime || 0);
    const perPieceMin = Number(def?.productionTimePerPiece || 0);

    const plannedMinutes = setupMin + perPieceMin * remaining;
    return Number.isFinite(plannedMinutes) && plannedMinutes > 0 ? plannedMinutes : 0;
  };

  const sortedPhases = useMemo(() => {
    const s = pendingSheet;
    if (!s?.product?.phases) return [];
    return [...(s.product.phases ?? [])]
      .filter((p: any) => !isDeletedPhase(p))
      .sort((a: any, b: any) => phasePosOf(a) - phasePosOf(b));
  }, [pendingSheet]);

  const preflightGuards = async () => {
    if (!user?.username) throw new Error(t("multiJob.errors.notLoggedIn"));

    const status = await api.getLiveStatus();

    const myDead = (status.dead || []).find((d: any) => d.username === user.username);
    if (myDead) {
      setBlockedDead({
        id: myDead.id,
        code: Number(myDead.code),
        description: myDead.description,
        productId: myDead.productId,
        orderNumber: myDead.orderNumber,
        productionSheetNumber: myDead.productionSheetNumber,
        runningSeconds: Number(myDead.runningSeconds || 0),
      });
      setBlockedPhase(null);
      setView("idle");
      throw new Error(t("multiJob.errors.deadTimeActive"));
    }

    const myLive = (status.active || []).find((x: any) => x.username === user.username);

    // if live exists but not multi -> block
    if (myLive && String(myLive.status || "") !== "multi") {
      setBlockedPhase({
        sheetId: myLive.sheetId,
        productionSheetNumber: myLive.productionSheetNumber,
        productId: myLive.productId,
        phaseId: String(myLive.phaseId ?? ""),
        runningSeconds: Number(myLive.runningSeconds || 0),
        status: String(myLive.status || ""),
      });
      setBlockedDead(null);
      setView("idle");
      throw new Error(t("multiJob.errors.activeSingleJob"));
    }

    // if live is multi, block starting another multi (you already resume it)
    if (myLive && String(myLive.status || "") === "multi") {
      throw new Error(t("multiJob.errors.activeLiveSession"));
    }

    const res = await api.getMyActivePhase();
    if (res?.active) {
      setBlockedPhase({
        sheetId: String(res.active.sheet_id ?? res.active.sheetId ?? ""),
        productionSheetNumber: String(
          res.active.production_sheet_number ?? res.active.productionSheetNumber ?? ""
        ),
        productId: String(res.active.product_id ?? res.active.productId ?? ""),
        phaseId: String(res.active.phase_id ?? res.active.phaseId ?? ""),
        runningSeconds: Number(res.active.running_seconds ?? res.active.runningSeconds ?? 0),
        status: "production",
      });
      setBlockedDead(null);
      setView("idle");
      throw new Error(t("multiJob.errors.activeSingleJob"));
    }
  };

  const handleScanSuccess = async (decodedText: string) => {
    setError(null);
    try {
      await preflightGuards();

      const raw = await api.getProductionSheetByQr(decodedText);
      const sheet = normalizeSheet(raw);

      setPendingSheet(sheet);
      setPendingQr(decodedText);
      setView("pickPhase");
    } catch (e) {
      setError((e as Error).message);
      setView("idle");
    }
  };

  const addJob = async (phaseId: string, productionPosition: number) => {
    if (!pendingSheet || !user?.username) return;

    const remaining = computeRemainingForPhase(pendingSheet, phaseId, productionPosition, jobs);

    if (remaining <= 0) {
      setError(t("multiJob.errors.nothingRemaining"));
      return;
    }

    const dup = jobs.some(
      (j) =>
        String(j.sheet.id) === String(pendingSheet.id) &&
        String(j.phaseId) === String(phaseId) &&
        posNum(j.position) === posNum(productionPosition)
    );
    if (dup) {
      setError(t("multiJob.errors.duplicateJob"));
      return;
    }

    setJobs((prev) => [
      ...prev,
      {
        id: uid(),
        qrValue: pendingQr,
        sheet: pendingSheet,
        phaseId: String(phaseId),
        position: posStr(productionPosition),
        stage: "production",
      },
    ]);

    setPendingSheet(null);
    setPendingQr("");
    setView("build");
  };

  const startSession = async () => {
    setError(null);
    if (!user?.username) return;

    if (jobs.length < 2) {
      setError(t("multiJob.errors.needAtLeastTwoJobs"));
      return;
    }

    try {
      await preflightGuards();

      const refreshedJobs = await Promise.all(
        jobs.map(async (j) => {
          const raw = await api.getProductionSheetByQr(j.qrValue);
          const sheet = normalizeSheet(raw);
          return { ...j, sheet };
        })
      );

      const plannedTotalMinutes = refreshedJobs.reduce((sum, j) => {
        const m = computePlannedMinutes(j.sheet, j.phaseId, j.position, refreshedJobs);
        return sum + (m > 0 ? m : 0);
      }, 0);

      const anchor = refreshedJobs[0];

      await api.startLivePhase({
        username: user.username,
        sheetId: String(anchor.sheet.id),
        productId: String(anchor.sheet.productId),
        phaseId: String(anchor.phaseId),
        position: posStr(anchor.position),
        plannedTime: Math.max(1, Math.ceil(plannedTotalMinutes || 1)),
        status: "multi",
      });

      setJobs(refreshedJobs);

      const items: StoredJobItem[] = refreshedJobs.map((j) => ({
        qrValue: j.qrValue,
        phaseId: String(j.phaseId),
        position: posStr(j.position),
        stage: j.stage,
      }));

      // DB-only persistence (do not swallow failures here)
      await saveStoredJobsServer(user.username, items);

      const status = await api.getLiveStatus();
      const myLive = (status.active || []).find((x: any) => x.username === user.username);

      const startFromBackend = parseMaybeDateMs(myLive?.start_time) ?? parseMaybeDateMs(myLive?.startTime);

      const serverNowMs = parseMaybeDateMs(myLive?.server_now);
      if (serverNowMs) clockSkewMsRef.current = serverNowMs - Date.now();

      const runningSeconds = Number(myLive?.runningSeconds ?? myLive?.running_seconds ?? 0) || 0;

      const startMs =
        startFromBackend ??
        (serverNowMs ? serverNowMs - runningSeconds * 1000 : Date.now() - runningSeconds * 1000);

      startTickingFromStart(startMs);

      setView("running");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stopSessionAndSave = async () => {
    if (!user?.username) return;

    clearTimer();
    setView("saving");
    setError(null);

    try {
      const status = await api.getLiveStatus();
      const myLive = (status.active || []).find((x: any) => x.username === user.username);

      const startFromBackend =
        parseMaybeDateMs((myLive as any)?.start_time) ??
        parseMaybeDateMs((myLive as any)?.startTime) ??
        parseMaybeDateMs((myLive as any)?.started_at) ??
        parseMaybeDateMs((myLive as any)?.startedAt);

      const runningSeconds =
        Number((myLive as any)?.runningSeconds ?? (myLive as any)?.running_seconds ?? 0) || 0;

      const sessionStartMs =
        startFromBackend ?? startTsRef.current ?? Date.now() - runningSeconds * 1000;

      const totalSeconds =
        runningSeconds > 0
          ? runningSeconds
          : Math.max(0, Math.floor((Date.now() - sessionStartMs) / 1000));

      startTsRef.current = sessionStartMs;
      setSeconds(totalSeconds);

      const refreshedJobs = await Promise.all(
        jobs.map(async (j) => {
          const raw = await api.getProductionSheetByQr(j.qrValue);
          const sheet = normalizeSheet(raw);
          return { ...j, sheet };
        })
      );

      const weights = refreshedJobs.map((j) => {
        const plannedMin = computePlannedMinutes(j.sheet, j.phaseId, j.position, refreshedJobs);
        return plannedMin > 0 ? plannedMin : 1;
      });

      const allocatedSeconds = splitSecondsProportionally(totalSeconds, weights);

      const qtyByJob: number[] = [];
      for (let i = 0; i < refreshedJobs.length; i++) {
        const j = refreshedJobs[i];
        const remaining = computeRemainingForPhase(j.sheet, j.phaseId, j.position, refreshedJobs);

        const phaseName =
          phasesDef.find((p) => String(p.id) === String(j.phaseId))?.name ||
          t("multiJob.phase.fallback", { id: j.phaseId });

        const promptText = t("multiJob.prompt.quantityDone", {
          phaseName,
          sheet: j.sheet.productionSheetNumber,
          remaining,
        });

        const ans = prompt(promptText, String(remaining));
        if (ans === null) throw new Error(t("multiJob.errors.cancelled"));
        const q = parseInt(ans.trim(), 10);
        if (!Number.isFinite(q) || q < 0 || q > remaining) {
          throw new Error(
            t("multiJob.errors.invalidQuantityForPhase", { phaseName, min: 0, max: remaining })
          );
        }
        qtyByJob.push(q);
      }

      let cursorMs = sessionStartMs;

      for (let i = 0; i < refreshedJobs.length; i++) {
        const j = refreshedJobs[i];
        const durSec = Math.max(0, Math.floor(allocatedSeconds[i] || 0));
        const qty = qtyByJob[i] || 0;

        const startIso = new Date(cursorMs).toISOString();
        const endMsForJob = cursorMs + durSec * 1000;
        const endIsoForJob = new Date(endMsForJob).toISOString();

        const newLog = await api.startPhase({
          operatorUsername: user.username,
          orderNumber: j.sheet.orderNumber,
          productionSheetNumber: j.sheet.productionSheetNumber,
          productId: j.sheet.productId,
          phaseId: j.phaseId,
          position: j.position,
          startTime: startIso,
          totalQuantity: qty,
          findMaterialTime: 0,
          setupTime: 0,
          stage: "production",
        });

        const logId = mapPhaseLog(newLog).id;
        await api.finishPhase(logId, endIsoForJob, qty, durSec);

        cursorMs = endMsForJob;
      }

      startTsRef.current = null;
      setSeconds(0);
      setJobs([]);
      setPendingSheet(null);
      setPendingQr("");
      setView("idle");
    } catch (e) {
      setError((e as Error).message);
      setView("build");
    } finally {
      if (user?.username) {
        await api.stopLivePhase(user.username).catch(() => {});
        await clearStoredJobsServer().catch(() => {});
      }
    }
  };

  const resetAll = async () => {
    clearTimer();
    startTsRef.current = null;
    setSeconds(0);
    setJobs([]);
    setPendingSheet(null);
    setPendingQr("");
    setError(null);
    setView("idle");

    if (user?.username) {
      await api.stopLivePhase(user.username).catch(() => {});
      await clearStoredJobsServer().catch(() => {});
    }
  };

  return (
    <>
      <ConfirmModal
        open={modalData.open}
        title={modalData.title}
        message={modalData.message}
        buttons={modalData.buttons}
        onClose={closeModal}
      />

      {(blockedDead || blockedPhase) ? (
        <>
          {/* BLOCK: DEAD TIME */}
          {blockedDead && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
              <h2 className="text-2xl font-bold mb-4">{t("deadTime.activeDeadTitle")}</h2>

              <p className="mb-2">
                <b>{t("deadTime.labels.code")}:</b> {blockedDead.code}
                {blockedDead.description ? ` – ${blockedDead.description}` : ""}
              </p>

              {blockedDead.orderNumber && blockedDead.productionSheetNumber && (
                <p className="mb-1">
                  <b>{t("deadTime.labels.sheet")}:</b> {blockedDead.orderNumber}/
                  {blockedDead.productionSheetNumber}
                </p>
              )}

              {blockedDead.productId && (
                <p className="mb-1">
                  <b>{t("deadTime.labels.product")}:</b> {blockedDead.productId}
                </p>
              )}

              <p className="mb-4">
                <b>{t("deadTime.labels.time")}:</b>{" "}
                {formatDuration(Number(blockedDead.runningSeconds || 0))}
              </p>

              <p className="text-sm text-gray-600">{t("machineOperator.deadTime.blockMessage")}</p>
            </div>
          )}

          {/* BLOCK: ACTIVE PHASE */}
          {!blockedDead && blockedPhase && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
              <h2 className="text-2xl font-bold mb-4">{t("deadTime.activePhaseTitle")}</h2>

              {blockedPhase.productionSheetNumber && (
                <p className="mb-1">
                  <b>{t("deadTime.labels.sheet")}:</b> {blockedPhase.productionSheetNumber}
                </p>
              )}

              {blockedPhase.productId && (
                <p className="mb-1">
                  <b>{t("deadTime.labels.product")}:</b> {blockedPhase.productId}
                </p>
              )}

              {blockedPhase.phaseId && (
                <p className="mb-1">
                  <b>{t("deadTime.labels.phase")}:</b> {blockedPhase.phaseId}
                </p>
              )}

              <p className="mb-4">
                <b>{t("deadTime.labels.running")}:</b>{" "}
                {Math.round(Number(blockedPhase.runningSeconds || 0) / 60)} min
              </p>

              <p className="text-sm text-gray-600">
                {t("deadTime.messages.cannotStartWhilePhaseRunning")}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* IDLE */}
          {view === "idle" && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
              <h2 className="text-2xl font-bold mb-2">{t("multiJob.title")}</h2>
              <p className="text-gray-600 mb-4">{t("multiJob.subtitle")}</p>

              <button
                onClick={() => setView("scanning")}
                className="w-full bg-indigo-600 text-white py-3 rounded-md"
              >
                {t("multiJob.startScanning")}
              </button>

              {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            </div>
          )}

          {/* SCANNING */}
          {view === "scanning" && (
            <div className="max-w-xl mx-auto">
              <Scanner onScanSuccess={handleScanSuccess} onScanError={(msg) => setError(msg)} />
              <button
                onClick={() => setView(jobs.length ? "build" : "idle")}
                className="mt-4 w-full bg-gray-500 text-white py-2 rounded-md"
              >
                {t("common.cancel")}
              </button>
              {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            </div>
          )}

          {/* PICK PHASE */}
          {view === "pickPhase" && pendingSheet && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-xl font-semibold">{t("multiJob.pickPhase.title")}</h3>
                  <div className="text-sm text-gray-600">
                    {t("multiJob.pickPhase.sheetLine", {
                      sheet: pendingSheet.productionSheetNumber,
                      order: pendingSheet.orderNumber,
                      product: pendingSheet.productId,
                      qty: pendingSheet.quantity,
                    })}
                  </div>
                </div>

                <button
                  className="bg-gray-200 text-gray-800 py-2 px-3 rounded-md"
                  onClick={() => {
                    setPendingSheet(null);
                    setPendingQr("");
                    setView(jobs.length ? "build" : "idle"); // ✅ prevents empty screen
                  }}
                >
                  {t("common.back")}
                </button>
              </div>

              <div className="space-y-2">
                {sortedPhases.map((ph: any) => {
                  const pos = phasePosOf(ph);

                  const alreadyAdded = jobs.some(
                    (j) =>
                      String(j.sheet.id) === String(pendingSheet.id) &&
                      String(j.phaseId) === String(ph.phaseId) &&
                      posNum(j.position) === posNum(pos)
                  );

                  const remaining = computeRemainingForPhase(
                    pendingSheet,
                    String(ph.phaseId),
                    pos,
                    jobs
                  );

                  const locked = alreadyAdded || remaining <= 0;

                  const name =
                    phasesDef.find((p) => String(p.id) === String(ph.phaseId))?.name ||
                    t("multiJob.phase.fallback", { id: ph.phaseId });

                  const plannedMin = computePlannedMinutes(
                    pendingSheet,
                    String(ph.phaseId),
                    pos,
                    jobs
                  );

                  return (
                    <div
                      key={phaseKeyOf(ph)}
                      className="p-3 border rounded-md flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold">{name}</div>
                        <div className="text-xs text-gray-600">
                          {t("multiJob.pickPhase.rowMeta", {
                            remaining,
                            pos,
                            planned: plannedMin.toFixed(1),
                          })}
                          {alreadyAdded ? (
                            <span className="ml-2 text-amber-700">• {t("multiJob.alreadyAddedTag")}</span>
                          ) : null}
                        </div>
                      </div>

                      <button
                        disabled={locked}
                        onClick={() => addJob(String(ph.phaseId), pos)}
                        className={
                          locked
                            ? "bg-gray-200 text-gray-400 py-2 px-3 rounded-md"
                            : "bg-indigo-600 text-white py-2 px-3 rounded-md"
                        }
                      >
                        {alreadyAdded ? t("multiJob.buttons.added") : t("multiJob.buttons.addJob")}
                      </button>
                    </div>
                  );
                })}
              </div>

              {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            </div>
          )}

          {/* BUILD LIST */}
          {view === "build" && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">{t("multiJob.build.title")}</h3>
                <button
                  className="bg-gray-200 text-gray-800 py-2 px-3 rounded-md"
                  onClick={resetAll}
                >
                  {t("common.reset")}
                </button>
              </div>

              {jobs.length === 0 ? (
                <div className="text-gray-600">{t("multiJob.build.empty")}</div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((j) => {
                    const phaseName =
                      phasesDef.find((p) => String(p.id) === String(j.phaseId))?.name ||
                      t("multiJob.phase.fallback", { id: j.phaseId });

                    const plannedMin = computePlannedMinutes(j.sheet, j.phaseId, j.position, jobs);

                    return (
                      <div
                        key={j.id}
                        className="p-3 border rounded-md flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">{phaseName}</div>
                          <div className="text-xs text-gray-600">
                            {t("multiJob.build.rowMeta", {
                              sheet: j.sheet.productionSheetNumber,
                              pos: j.position,
                              planned: plannedMin.toFixed(1),
                            })}
                          </div>
                        </div>

                        <button
                          className="bg-red-600 text-white py-2 px-3 rounded-md"
                          onClick={() => setJobs((prev) => prev.filter((x) => x.id !== j.id))}
                        >
                          {t("multiJob.buttons.remove")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  className="bg-gray-500 text-white py-3 rounded-md"
                  onClick={() => setView("scanning")}
                >
                  {t("multiJob.buttons.addAnotherScan")}
                </button>

                <button
                  className={
                    jobs.length < 2
                      ? "bg-gray-300 text-gray-500 py-3 rounded-md cursor-not-allowed"
                      : "bg-indigo-600 text-white py-3 rounded-md"
                  }
                  disabled={jobs.length < 2} // ✅ makes UX match the real rule
                  onClick={startSession}
                >
                  {t("multiJob.buttons.startSessionTimer")}
                </button>
              </div>

              {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            </div>
          )}

          {/* RUNNING */}
          {view === "running" && (
            <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
              <h3 className="text-xl font-semibold mb-2">{t("multiJob.running.title")}</h3>
              <div className="text-4xl font-bold mb-2">{seconds}s</div>
              <div className="text-sm text-gray-600 mb-4">
                {t("multiJob.running.jobsSelected", { count: jobs.length })}
              </div>

              <button
                className="w-full bg-red-600 text-white py-3 rounded-md"
                onClick={stopSessionAndSave}
              >
                {t("multiJob.buttons.stopAndCreateLogs")}
              </button>

              {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
            </div>
          )}

          {/* SAVING / RESUMING */}
          {view === "saving" && (
            <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
              <div className="bg-white rounded-lg shadow-xl px-6 py-4">{t("multiJob.working")}</div>
            </div>
          )}

          {/* HARD FALLBACK to avoid blank UI if view/state mismatch */}
          {view !== "idle" &&
            view !== "scanning" &&
            !(view === "pickPhase" && pendingSheet) &&
            view !== "build" &&
            view !== "running" &&
            view !== "saving" && (
              <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto text-center">
                <div className="text-lg font-semibold mb-2">UI state mismatch</div>
                <div className="text-sm text-gray-600 mb-4">view: {view}</div>
                <button
                  className="w-full bg-gray-800 text-white py-3 rounded-md"
                  onClick={resetAll}
                >
                  {t("common.reset")}
                </button>
              </div>
            )}
        </>
      )}
    </>
  );
};

export default MultiJobOperatorView;
