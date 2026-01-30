import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { Product, ProductForUI, ProductionSheet, Phase } from "../src/types";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { useAuth } from "../hooks/useAuth";

// ----------------------------------------------------
// Helpers (stable phase identity to avoid "ghost phase")
// ----------------------------------------------------
type PhaseWithUID = any & { __uid?: string; __deleted?: boolean };
type ProductDefWithMeta = any & {
  __lockedPositions?: string[];
  __materialsLocked?: boolean;
};

const makeUid = () =>
  (globalThis.crypto as any)?.randomUUID
    ? (globalThis.crypto as any).randomUUID()
    : `ph_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const posNum = (v: any) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isNaN(n) ? 0 : n;
};
const normPos = (v: unknown): string => String(v ?? "").trim();
const normalizeTo10 = (n: number) => Math.round(n / 10) * 10;

const ensurePhaseUids = (phases: any[]) =>
  (phases || []).map((p: PhaseWithUID) => ({ ...p, __uid: p.__uid || makeUid() }));

const sortPhases = (phases: any[], useProduction: boolean) =>
  [...(phases || [])].sort(
    (a, b) =>
      posNum(useProduction ? a.productionPosition : a.position) -
      posNum(useProduction ? b.productionPosition : b.position)
  );

// =====================================================
// ProductDefinition Component
// =====================================================
const ProductDefinition: React.FC<{
  product: ProductForUI;
  updateProduct: (p: ProductForUI) => void;
  phasesList: Phase[];
  autoPositioning?: boolean; // create: true, update: false
  showPhasePosition?: boolean; // update mode
  lockedPositions?: string[]; // from phase_logs
  materialsLocked?: boolean; // if any phase started
  onPhaseDeleted?: (info: { position: string; phaseId: string; productionPosition?: string }) => void; // ✅ NEW
}> = ({
  product,
  updateProduct,
  phasesList,
  autoPositioning = true,
  showPhasePosition = false,
  lockedPositions = [],
  materialsLocked = false,
  onPhaseDeleted,
}) => {
  const { t } = useTranslation();
  const qty = (product as any).quantity || 0;

  const lockedSet = useMemo(() => new Set((lockedPositions || []).map(normPos)), [lockedPositions]);

  // ✅ update mode uses productionPosition ordering
  const useProductionOrdering = !autoPositioning;

  const renumberMaterials = (materials: any[]) =>
    (materials || []).map((m, i) => ({ ...m, position: String((i + 1) * 10) }));

  const shiftAllPhasePositions = (phases: any[], delta10: number) =>
    (phases || []).map((p) => {
      const newPos = String(normalizeTo10(posNum(p.position) + delta10));
      const newProdPos = String(normalizeTo10(posNum(p.productionPosition ?? p.position) + delta10));
      return {
        ...p,
        position: newPos,
        productionPosition: newProdPos, // ✅ keep in sync in create mode
      };
    });

  const sanitizeLayoutCreateMode = (materials: any[], phases: any[]) => {
    // Create mode: always compact
    const mats = renumberMaterials(materials || []);
    const maxMatPos = mats.length * 10;

    let phs = ensurePhaseUids(phases || [])
      .filter((p: any) => !p.__deleted)
      .map((p: any, i: number) => {
        const newPos = String(maxMatPos + (i + 1) * 10);
        return {
          ...p,
          position: newPos,
          productionPosition: newPos, // ✅ NEW
        };
      });

    phs = sortPhases(phs, false);

    return { materials: mats, phases: phs };
  };

  // Ensure stable uid
  useEffect(() => {
    const phases = (product as any).phases || [];
    if (!Array.isArray(phases) || phases.length === 0) return;

    if (phases.some((p: PhaseWithUID) => !p.__uid)) {
      const copy: any = { ...product };
      copy.phases = phases.map((p: PhaseWithUID) => ({
        ...p,
        __uid: p.__uid || makeUid(),
      }));
      updateProduct(copy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.phases]);

  // Visible phases only (hide deleted + tombstones) + KEEP ORIGINAL INDEX
  const phasesWithIndex = useMemo(() => {
    const all = ((product as any).phases || []) as PhaseWithUID[];

    return all
      .map((p, originalIndex) => ({
        p: { ...p, __uid: p.__uid || "" },
        originalIndex,
      }))
      .filter(({ p }) => !p.__deleted && String(p.phaseId || "").trim() !== "")
      .sort((a, b) => {
        const av = useProductionOrdering ? a.p.productionPosition : a.p.position;
        const bv = useProductionOrdering ? b.p.productionPosition : b.p.position;
        return posNum(av) - posNum(bv);
      });
  }, [product.phases, useProductionOrdering]);

  const updateField = (field: "materials" | "phases", index: number, key: string, value: any) => {
    const copy: any = { ...product };
    copy.materials = [...(copy.materials || [])];
    copy.phases = [...(copy.phases || [])];

    // MATERIALS LOCK
    if (field === "materials" && materialsLocked) return;

    // PHASE LOCK (by ORIGINAL position from phase_logs)
    if (field === "phases") {
      const ph = copy.phases[index];
      if (ph && lockedSet.has(normPos(ph.position))) return;
    }

    // ---- MATERIALS ----
    if (field === "materials" && key === "totalQuantity") {
      const total = parseFloat(value) || 0;
      copy.materials[index] = { ...copy.materials[index] };
      copy.materials[index].totalQuantity = parseFloat(total.toFixed(2));
      copy.materials[index].quantityPerPiece = qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;

      if (autoPositioning) copy.materials = renumberMaterials(copy.materials);
    }
    // ---- PHASE PRODUCTION TIME ----
    else if (field === "phases" && key === "totalProductionTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index] = { ...copy.phases[index] };
      copy.phases[index].totalProductionTime = parseFloat(total.toFixed(2));
      copy.phases[index].productionTimePerPiece = qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;

      // create mode: auto position
      if (autoPositioning) {
        const newPos = String((copy.materials.length + index + 1) * 10);
        copy.phases[index].position = newPos;
        copy.phases[index].productionPosition = newPos; // ✅ keep same in create
      }
    }
    // ---- PHASE SETUP TIME ----
    else if (field === "phases" && key === "totalSetupTime") {
      const total = parseFloat(value) || 0;
      copy.phases[index] = { ...copy.phases[index] };
      copy.phases[index].totalSetupTime = parseFloat(total.toFixed(2));
      copy.phases[index].setupTime = parseFloat(total.toFixed(2));

      if (autoPositioning) {
        const newPos = String((copy.materials.length + index + 1) * 10);
        copy.phases[index].position = newPos;
        copy.phases[index].productionPosition = newPos; // ✅ keep same in create
      }
    }
    // ---- DIRECT FIELD ----
    else {
      copy[field][index] = { ...copy[field][index], [key]: value };
      if (field === "materials" && autoPositioning) copy.materials = renumberMaterials(copy.materials);
    }

    copy.phases = sortPhases(copy.phases, useProductionOrdering);
    updateProduct(copy);
  };

  const addMaterial = () => {
    if (materialsLocked) return;

    const copy: any = { ...product };
    copy.materials = [...(copy.materials || [])];
    copy.phases = [...(copy.phases || [])];

    copy.materials.push({
      materialId: "",
      quantityPerPiece: 0,
      totalQuantity: 0,
      position: "0",
    });

    // Only shift phases in create mode
    if (autoPositioning) {
      copy.phases = shiftAllPhasePositions(copy.phases, +10);
      const fixed = sanitizeLayoutCreateMode(copy.materials, copy.phases);
      copy.materials = fixed.materials;
      copy.phases = fixed.phases;
    }

    updateProduct(copy);
  };

  const removeMaterial = (index: number) => {
    if (materialsLocked) return;

    const copy: any = { ...product };
    copy.materials = [...(copy.materials || [])];
    copy.phases = [...(copy.phases || [])];

    copy.materials.splice(index, 1);

    if (autoPositioning) {
      copy.phases = shiftAllPhasePositions(copy.phases, -10);
      const fixed = sanitizeLayoutCreateMode(copy.materials, copy.phases);
      copy.materials = fixed.materials;
      copy.phases = fixed.phases;
    }

    updateProduct(copy);
  };

  // ✅ update mode: tombstone + phase log
  const removePhase = (renderIndex: number) => {
    const cur = phasesWithIndex[renderIndex]?.p as PhaseWithUID | undefined;
    if (!cur?.__uid) return;

    const pos = normPos(cur.position);
    if (lockedSet.has(pos)) return;

    const copy: any = { ...product };
    copy.phases = [...(copy.phases || [])];

    const idx = copy.phases.findIndex((x: PhaseWithUID) => x.__uid === cur.__uid);
    if (idx < 0) return;

    // create mode: remove
    if (autoPositioning) {
      copy.phases.splice(idx, 1);
      copy.phases = sortPhases(copy.phases, false);
      updateProduct(copy);
      return;
    }

    const original = copy.phases[idx];

    // best-effort phase log trigger
    onPhaseDeleted?.({
      position: String(original.position ?? ""),
      phaseId: String(original.phaseId ?? ""),
      productionPosition: String(original.productionPosition ?? ""),
    });

    // tombstone: keep original position, mark productionPosition=DELETED
    copy.phases[idx] = {
      ...original,
      phaseId: "",
      __deleted: true,
      productionPosition: "DELETED",
    };

    copy.phases = sortPhases(copy.phases, true);
    updateProduct(copy);
  };

  const addPhase = () => {
    const copy: any = { ...product };
    copy.materials = [...(copy.materials || [])];
    copy.phases = ensurePhaseUids([...(copy.phases || [])]);

    if (autoPositioning) {
      const fixed = sanitizeLayoutCreateMode(copy.materials, copy.phases);
      copy.materials = fixed.materials;
      copy.phases = fixed.phases;

      const maxPos = copy.phases.reduce((mx: number, p: any) => Math.max(mx, posNum(p.position)), 0);
      const newPos = String(normalizeTo10((maxPos || copy.materials.length * 10) + 10));

      copy.phases.push({
        __uid: makeUid(),
        phaseId: phasesList[0]?.id || "",
        setupTime: 0,
        totalSetupTime: 0,
        productionTimePerPiece: 0,
        totalProductionTime: 0,
        position: newPos,
        productionPosition: newPos, // ✅ keep same in create
      });

      const fixed2 = sanitizeLayoutCreateMode(copy.materials, copy.phases);
      copy.materials = fixed2.materials;
      copy.phases = fixed2.phases;
      updateProduct(copy);
      return;
    }

    // ✅ update mode: position="EXTRA", productionPosition=last+10
    const maxProdPos = copy.phases.reduce((mx: number, ph: any) => {
      const v = posNum(ph.productionPosition ?? ph.position);
      return v > mx ? v : mx;
    }, 0);

    const newProdPos = String(normalizeTo10((maxProdPos || 0) + 10));

    const extraIndex = (phases: any[]) => {
      let max = 0;

      for (const p of phases || []) {
        const pos = String(p.position ?? "");
        const m = pos.match(/^EXTRA-(\d+)$/i);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }

      return max + 1;
    };

    copy.phases.push({
      __uid: makeUid(),
      phaseId: phasesList[0]?.id || "",
      setupTime: 0,
      totalSetupTime: 0,
      productionTimePerPiece: 0,
      totalProductionTime: 0,
      position: `EXTRA-${extraIndex(copy.phases)}`,
      productionPosition: newProdPos,
    });

    copy.phases = sortPhases(copy.phases, true);
    updateProduct(copy);
  };

  // ✅ update mode reorder: swap productionPosition only (do NOT touch position)
  const movePhase = (renderIndex: number, direction: -1 | 1) => {
    const a = phasesWithIndex[renderIndex]?.p as PhaseWithUID | undefined;
    const b = phasesWithIndex[renderIndex + direction]?.p as PhaseWithUID | undefined;
    if (!a?.__uid || !b?.__uid) return;

    const posA = normPos(a.position);
    const posB = normPos(b.position);
    if (lockedSet.has(posA) || lockedSet.has(posB)) return;

    const copy: any = { ...product };
    copy.phases = [...(copy.phases || [])];

    const aIdx = copy.phases.findIndex((x: PhaseWithUID) => x.__uid === a.__uid);
    const bIdx = copy.phases.findIndex((x: PhaseWithUID) => x.__uid === b.__uid);
    if (aIdx < 0 || bIdx < 0) return;

    const pa = { ...copy.phases[aIdx] };
    const pb = { ...copy.phases[bIdx] };

    if (autoPositioning) {
      // create mode: swap position (and keep prod in sync)
      const tmp = pa.position;
      pa.position = pb.position;
      pb.position = tmp;
      pa.productionPosition = pa.position;
      pb.productionPosition = pb.position;

      copy.phases[aIdx] = pa;
      copy.phases[bIdx] = pb;

      copy.phases = sortPhases(copy.phases, false);
      updateProduct(copy);
      return;
    }

    // update mode: swap productionPosition only
    const tmpProd = pa.productionPosition ?? pa.position;
    pa.productionPosition = pb.productionPosition ?? pb.position;
    pb.productionPosition = tmpProd;

    copy.phases[aIdx] = pa;
    copy.phases[bIdx] = pb;

    copy.phases = sortPhases(copy.phases, true);
    updateProduct(copy);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
      {/* MATERIALS */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">{t("orderkeeper.materials")}</h4>

        {(product.materials || []).map((m: any, i: number) => {
          const totalQty = m.totalQuantity !== undefined ? m.totalQuantity : (m.quantityPerPiece || 0) * qty;

          return (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <div className="col-span-5">
                <input
                  type="text"
                  placeholder={t("orderkeeper.materialId")}
                  value={m.materialId}
                  onChange={(e) => updateField("materials", i, "materialId", e.target.value)}
                  className="input-style"
                  disabled={materialsLocked}
                />
              </div>

              <div className="col-span-5">
                <label className="block text-xs text-gray-600 mb-1">
                  {t("orderkeeper.qtyPerPiece")}: {Number(m.quantityPerPiece || 0).toFixed(2)}
                </label>
                <input
                  type="number"
                  placeholder={t("orderkeeper.placeholders.totalQty")}
                  value={totalQty}
                  onChange={(e) => updateField("materials", i, "totalQuantity", e.target.value)}
                  className="input-style"
                  disabled={materialsLocked}
                />
              </div>

              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeMaterial(i)}
                  className="btn-secondary text-sm px-2"
                  title={t("orderkeeper.removeMaterial")}
                  disabled={materialsLocked}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}

        <button onClick={addMaterial} className="btn-secondary text-sm" disabled={materialsLocked}>
          {t("orderkeeper.addMaterial")}
        </button>

        {materialsLocked && (
          <div className="text-xs text-red-600 mt-2">{t("orderkeeper.alerts.materialsLocked")}</div>
        )}
      </div>

      {/* PHASES */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">{t("orderkeeper.phases")}</h4>

        {phasesWithIndex.map(({ p, originalIndex }, renderIndex: number) => {
          const totalProd =
            p.totalProductionTime !== undefined ? p.totalProductionTime : (p.productionTimePerPiece || 0) * qty;

          const totalSetup = p.totalSetupTime !== undefined ? p.totalSetupTime : p.setupTime;
          const isLocked = lockedSet.has(normPos(p.position));
          const prodPos = (p as any).productionPosition ?? p.position;

          return (
            <div
              key={(p as any).__uid || `${originalIndex}-${p.phaseId}-${p.position}-${prodPos}`}
              className="grid grid-cols-12 gap-x-3 gap-y-2 mb-3 p-2 rounded-md border bg-white"
            >
              <div className="col-span-4">
                <select
                  value={p.phaseId}
                  onChange={(e) => updateField("phases", originalIndex, "phaseId", e.target.value)}
                  className="input-style"
                  disabled={isLocked}
                >
                  {phasesList.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-3">
                <label className="block text-xs text-gray-600 mb-1">
                  {t("orderkeeper.labels.setupPerPhase")}: {Number(p.setupTime || 0).toFixed(1)}{" "}
                  {t("orderkeeper.units.minutes")}
                </label>
                <input
                  type="number"
                  placeholder={t("orderkeeper.placeholders.setupMinutes")}
                  value={totalSetup}
                  onChange={(e) => updateField("phases", originalIndex, "totalSetupTime", e.target.value)}
                  className="input-style"
                  disabled={isLocked}
                />
              </div>

              <div className="col-span-3">
                <label className="block text-xs text-gray-600 mb-1">
                  {t("orderkeeper.labels.prodPerPiece")}: {Number(p.productionTimePerPiece || 0).toFixed(2)}{" "}
                  {t("orderkeeper.units.minutes")}
                </label>
                <input
                  type="number"
                  placeholder={t("orderkeeper.placeholders.totalMinutes")}
                  value={totalProd}
                  onChange={(e) => updateField("phases", originalIndex, "totalProductionTime", e.target.value)}
                  className="input-style"
                  disabled={isLocked}
                />
              </div>

              <div className="col-span-2 flex flex-col items-end gap-1">
                {showPhasePosition && (
                  <div className="col-span-12 text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                    {t("orderkeeper.position")}: <span className="font-semibold">{p.position}</span>
                    {"  "} | {"  "}
                    {t("orderkeeper.productionPosition")}:{" "}
                    <span className="font-semibold">{String(prodPos)}</span>
                    {isLocked ? <span className="ml-1 text-red-600">({t("orderkeeper.lockedTag")})</span> : null}
                  </div>
                )}

                <div className="col-span-12 md:col-span-2 flex justify-end items-end gap-1">
                  {showPhasePosition && (
                    <>
                      <button
                        type="button"
                        onClick={() => movePhase(renderIndex, -1)}
                        disabled={
                          renderIndex === 0 ||
                          isLocked ||
                          lockedSet.has(normPos(phasesWithIndex[renderIndex - 1]?.p?.position))
                        }
                        className="btn-secondary text-sm px-2"
                        title={t("orderkeeper.moveUp")}
                      >
                        ▲
                      </button>

                      <button
                        type="button"
                        onClick={() => movePhase(renderIndex, +1)}
                        disabled={
                          renderIndex === phasesWithIndex.length - 1 ||
                          isLocked ||
                          lockedSet.has(normPos(phasesWithIndex[renderIndex + 1]?.p?.position))
                        }
                        className="btn-secondary text-sm px-2"
                        title={t("orderkeeper.moveDown")}
                      >
                        ▼
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => removePhase(renderIndex)}
                    disabled={isLocked}
                    className="btn-secondary text-sm px-2"
                    title={t("orderkeeper.removePhase")}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <button onClick={addPhase} className="btn-secondary text-sm">
          {t("orderkeeper.addPhase")}
        </button>
      </div>
    </div>
  );
};

export { ProductDefinition };

// =====================================================
// Main OrderKeeperView
// =====================================================
type Mode = "idle" | "create" | "update" | "reprint";

const OrderKeeperView: React.FC = () => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>("idle");

  const [orderNumber, setOrderNumber] = useState("");
  const [orderLocked, setOrderLocked] = useState(false);

  const [targetSheetNumber, setTargetSheetNumber] = useState("");
  const [sheetLocked, setSheetLocked] = useState(false);

  const [sheets, setSheets] = useState<
    { number: string; productId: string; quantity: string; productDef: ProductForUI }[]
  >([]);

  const [generatedSheets, setGeneratedSheets] = useState<ProductionSheet[]>([]);
  const [existingSheetsForReprint, setExistingSheetsForReprint] = useState<ProductionSheet[]>([]);
  const [selectedSheetsToReprint, setSelectedSheetsToReprint] = useState<string[]>([]);

  const [existingProducts, setExistingProducts] = useState<Product[]>([]);
  const [phasesList, setPhasesList] = useState<Phase[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Prevent repeated auto-confirm calls
  const lastConfirmedOrderRef = useRef<{ mode: Mode; order: string } | null>(null);
  const lastConfirmedSheetRef = useRef<{ order: string; sheet: string } | null>(null);

  const { user } = useAuth();

  useEffect(() => {
    api.getProducts().then(setExistingProducts);
    api.getPhases().then(setPhasesList);
  }, []);

  const canProceed = useMemo(() => {
    if (!orderLocked) return false;
    if (mode === "update") return sheetLocked;
    return mode === "create" || mode === "reprint";
  }, [orderLocked, sheetLocked, mode]);

  const resetAll = () => {
    setOrderNumber("");
    setOrderLocked(false);
    setTargetSheetNumber("");
    setSheetLocked(false);
    setMode("idle");
    setSheets([]);
    setExistingSheetsForReprint([]);
    setSelectedSheetsToReprint([]);
    setGeneratedSheets([]);
    lastConfirmedOrderRef.current = null;
    lastConfirmedSheetRef.current = null;
  };

  const setModeAndReset = (m: Mode) => {
    setMode(m);
    setOrderNumber("");
    setOrderLocked(false);
    setTargetSheetNumber("");
    setSheetLocked(false);
    setSheets([]);
    setExistingSheetsForReprint([]);
    setSelectedSheetsToReprint([]);
    setGeneratedSheets([]);
    lastConfirmedOrderRef.current = null;
    lastConfirmedSheetRef.current = null;
  };

  const addSheet = () => {
    setSheets((prev) => [
      ...prev,
      {
        number: "",
        productId: "",
        quantity: "",
        productDef: { id: "", name: "", quantity: 0, materials: [], phases: [] } as any,
      },
    ]);
  };

  const updateSheet = (index: number, field: keyof (typeof sheets)[0], value: any) => {
    const newSheets = [...sheets];
    const sheet = { ...newSheets[index] };
    (sheet as any)[field] = value;

    const qty = Math.max(0, parseInt(field === "quantity" ? value : sheet.quantity || "0", 10) || 0);

    if (field === "productId" || field === "quantity") {
      const base = existingProducts.find((p) => p.id === sheet.productId);
      if (base) {
        const copy: any = JSON.parse(JSON.stringify(base));
        copy.name = base.name;
        copy.quantity = qty;

        copy.materials = (copy.materials || []).map((m: any, i: number) => {
          const total = m.totalQuantity ?? m.quantityPerPiece * qty;
          return {
            ...m,
            totalQuantity: total,
            quantityPerPiece: qty > 0 ? total / qty : m.quantityPerPiece,
            position: String(m.position ?? (i + 1) * 10),
          };
        });

        copy.phases = ensurePhaseUids(copy.phases || []).map((p: any, i: number) => {
          const totalProd = p.totalProductionTime ?? p.productionTimePerPiece * qty;
          const totalSetup = p.totalSetupTime ?? p.setupTime;
          const fallbackPos = String(p.position ?? (copy.materials.length + i + 1) * 10);
          return {
            ...p,
            __uid: p.__uid || makeUid(),
            totalProductionTime: totalProd,
            productionTimePerPiece: qty > 0 ? totalProd / qty : p.productionTimePerPiece,
            totalSetupTime: totalSetup,
            setupTime: totalSetup,
            position: fallbackPos,
            productionPosition: String(p.productionPosition ?? fallbackPos), // ✅ NEW
          };
        });

        sheet.productDef = copy;
      }
    }

    newSheets[index] = sheet;
    setSheets(newSheets);
  };

  // Build DTO that works with backend merge-by-position and supports update ordering by productionPosition + tombstones
  const toProductDefDTO = (p: ProductDefWithMeta, useProdOrdering: boolean): any => {
    const qty = Number((p as any).quantity || 0);

    const materials = (p.materials || []).map((m: any, i: number) => ({
      materialId: String(m.materialId || "").trim(),
      quantityPerPiece: Number(m.quantityPerPiece || 0),
      totalQuantity: m.totalQuantity != null ? Number(m.totalQuantity) : undefined,
      position: m.position != null ? String(m.position) : String((i + 1) * 10),
    }));

    // ✅ create mode: only real phases
    // ✅ update mode: include tombstones (phaseId="") so backend can clear, and order by productionPosition
    const phases = ensurePhaseUids(p.phases || [])
      .filter((ph: any) => {
        if (useProdOrdering) return true; // keep tombstones too
        return !ph.__deleted && String(ph.phaseId || "").trim() !== "";
      })
      .map((ph: any) => ({
        phaseId: String(ph.phaseId ?? "").trim(), // can be "" for tombstone
        position: String(ph.position ?? ""),
        productionPosition: String(ph.productionPosition ?? (useProdOrdering ? "" : ph.position ?? "")),
        setupTime: Number(ph.setupTime || 0),
        productionTimePerPiece: Number(ph.productionTimePerPiece || 0),
        totalSetupTime: ph.totalSetupTime != null ? Number(ph.totalSetupTime) : undefined,
        totalProductionTime: ph.totalProductionTime != null ? Number(ph.totalProductionTime) : undefined,
      }))
      .sort((a: any, b: any) =>
        posNum(useProdOrdering ? a.productionPosition : a.position) -
        posNum(useProdOrdering ? b.productionPosition : b.position)
      );

    return {
      id: p.id,
      name: p.name || p.id,
      materials,
      phases,
    };
  };

  // ✅ phase log creation on delete (best-effort; won’t block UI)
  const createDeletedPhaseLog = async (info: { position: string; phaseId: string; productionPosition?: string }) => {
    if (mode !== "update") return;
    const ord = orderNumber.trim();
    const sheetNum = sheets[0]?.number;
    if (!ord || !sheetNum) return;
    if (!user) return;

    try {
      const fn = (api as any).createPhaseLog;
      if (typeof fn !== "function") return;

      await fn({
        operatorUsername: user.username,
        orderNumber: ord,
        productionSheetNumber: sheetNum,
        position: info.position, // ✅ original position preserved
        productionPosition: "DELETED",
        phaseId: info.phaseId || null,
      });
    } catch (e) {
      console.warn("createPhaseLog failed", e);
    }
  };

  const handleSave = async () => {
    if (!orderNumber.trim() || sheets.length === 0) return;
    setIsSaving(true);

    try {
      // 1) upsert products (base catalog)
      for (const sheet of sheets) {
        const qty = parseInt(sheet.quantity || "0", 10);
        if (!sheet.productId || qty <= 0 || !sheet.productDef) continue;

        const base: any = sheet.productDef;

        const normalizedProduct: Product = {
          id: base.id || sheet.productId,
          name: base.name || sheet.productId,
          materials: (base.materials || []).map((m: any) => {
            const total =
              m.totalQuantity != null
                ? parseFloat(String(m.totalQuantity))
                : (m.quantityPerPiece || 0) * qty;
            return {
              materialId: m.materialId,
              quantityPerPiece: qty > 0 ? total / qty : 0,
            };
          }),
          phases: (base.phases || [])
            .filter((p: any) => String(p.phaseId || "").trim() !== "" && !p.__deleted)
            .map((p: any) => {
              const totalProd =
                p.totalProductionTime != null
                  ? parseFloat(String(p.totalProductionTime))
                  : (p.productionTimePerPiece || 0) * qty;
              const setup =
                p.totalSetupTime != null ? parseFloat(String(p.totalSetupTime)) : p.setupTime || 0;
              return {
                phaseId: p.phaseId,
                setupTime: setup,
                productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
              };
            }),
        };

        await api.saveProduct(normalizedProduct);
      }

      const fresh = await api.getProducts();
      setExistingProducts(fresh);

      // 2) build DTOs
      const sheetDtos = sheets
        .filter((s) => s.productId && parseInt(s.quantity, 10) > 0)
        .map((s) => ({
          productionSheetNumber: s.number,
          productId: s.productId,
          quantity: parseInt(s.quantity, 10),
          orderNumber,
          productDef: toProductDefDTO(s.productDef as any, mode === "update"),
        }));

      if (sheetDtos.length === 0) return;

      // 3) MODE ACTIONS
      if (mode === "update") {
        const sh = sheetDtos[0];

        const r: any = await api.updateProductionSheetForOrder(orderNumber.trim(), sh.productionSheetNumber, {
          quantity: sh.quantity,
          productDef: sh.productDef,
        });

        const lockedPositions: string[] = Array.isArray(r.lockedPositions) ? r.lockedPositions : [];
        alert(t("orderkeeper.alerts.updatedSuccess"));

        // Refresh sheet from backend
        const refreshed: any = await api.getProductionSheetForOrder(orderNumber.trim(), sh.productionSheetNumber);

        const snap = refreshed.productSnapshot || null;
        const qty = Number(refreshed.quantity || 0);

        const base = snap
          ? {
              id: snap.id || refreshed.productId,
              name: snap.name || (snap.id || refreshed.productId),
              materials: Array.isArray(snap.materials) ? snap.materials : [],
              phases: Array.isArray(snap.phases) ? snap.phases : [],
            }
          : (() => {
              const p = existingProducts.find((x) => x.id === refreshed.productId);
              return {
                id: p?.id || refreshed.productId,
                name: p?.name || refreshed.productId,
                materials: p?.materials || [],
                phases: p?.phases || [],
              };
            })();

        const productDef: ProductDefWithMeta = {
          id: base.id,
          name: base.name,
          quantity: qty,
          __lockedPositions: lockedPositions,
          __materialsLocked: lockedPositions.length > 0,
          materials: (base.materials || []).map((m: any, i: number) => {
            const qpp = Number(m.quantityPerPiece ?? 0);
            const total = Number(m.totalQuantity ?? qpp * qty);
            return {
              materialId: m.materialId,
              quantityPerPiece: qty > 0 ? total / qty : 0,
              totalQuantity: total,
              position: String(m.position ?? (i + 1) * 10),
            };
          }),
          phases: ensurePhaseUids(base.phases || []).map((p: any, i: number) => {
            const prodPerPiece = Number(p.productionTimePerPiece ?? 0);
            const totalProd = Number(p.totalProductionTime ?? prodPerPiece * qty);
            const setup = Number(p.totalSetupTime ?? p.setupTime ?? 0);
            const fallbackPos = String(p.position ?? ((base.materials?.length || 0) + i + 1) * 10);
            return {
              ...p,
              __uid: p.__uid || makeUid(),
              __deleted: String(p.phaseId || "").trim() === "",
              phaseId: p.phaseId,
              setupTime: setup,
              totalSetupTime: setup,
              productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
              totalProductionTime: totalProd,
              position: fallbackPos,
              productionPosition: String(p.productionPosition ?? fallbackPos), // ✅ NEW
            };
          }),
        };

        setSheets([
          {
            number: refreshed.productionSheetNumber,
            productId: refreshed.productId,
            quantity: String(qty),
            productDef: productDef as any,
          },
        ]);

        return;
      }

      if (mode === "create") {
        const newSheets = await api.createOrderAndSheets(orderNumber, sheetDtos as any);
        setGeneratedSheets(newSheets);
      }
    } catch (error) {
      console.error("Failed to save order:", error);
      alert(t("orderkeeper.alerts.saveFailed", { message: (error as Error).message }));
    } finally {
      setIsSaving(false);
    }
  };

  const printSheets = (sheetsToPrint: ProductionSheet[], layout: "sticker" | "full") => {
    if (sheetsToPrint.length === 0) return;
    const printWindow = window.open("", "_blank", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = layout === "full" ? 37.125 : 33.9;
    const verticalPadding = layout === "full" ? 0 : 12.9;

    printWindow.document.write(`
      <html><head><title>Print Production Sheets</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; } }
        html, body { margin: 0 !important; padding: 0 !important; background: white; }
        .page {
          display: grid;
          grid-template-columns: repeat(3, 70mm);
          grid-template-rows: repeat(8, ${cellHeight}mm);
          width: 210mm;
          height: 297mm;
          padding: ${verticalPadding}mm 0;
          box-sizing: border-box;
        }
        .cell {
          width: 70mm; height: ${cellHeight}mm;
          display: flex; flex-direction: column;
          justify-content: center; align-items: center;
          text-align: center;
          box-sizing: border-box;
          padding: 2mm; overflow: hidden;
        }
        .cell svg { width: 22mm; height: 22mm; }
        .cell p { margin: 1mm 0 0 0; font-size: 10px; line-height: 1.1; font-weight: bold; }
      </style></head><body><div class="page">`);

    sheetsToPrint.forEach((sheet) => {
      const svg = renderToStaticMarkup(<QRCodeSVG value={sheet.qrValue} size={128} />);
      printWindow.document.write(
        `<div class="cell">${svg}<p>${sheet.productId}</p><p>${sheet.productionSheetNumber}</p></div>`
      );
    });

    printWindow.document.write(`</div></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  const confirmOrder = async () => {
    if (!orderNumber.trim() || mode === "idle") return;

    setIsLoading(true);
    try {
      if (mode === "create") {
        setOrderLocked(true);
        if (sheets.length === 0) addSheet();
        return;
      }

      if (mode === "update") {
        setOrderLocked(true);
        setSheets([]);
        setTargetSheetNumber("");
        setSheetLocked(false);
        return;
      }

      if (mode === "reprint") {
        const sheetsFromApi = await api.getSheetsByOrderId(orderNumber.trim());
        if (!sheetsFromApi || sheetsFromApi.length === 0) {
          throw new Error(t("orderkeeper.errors.noSheetsForOrder"));
        }
        setExistingSheetsForReprint(sheetsFromApi);
        setOrderLocked(true);
        return;
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Compute locked positions from phase_logs (exclude DELETED logs)
  const getLockedPositionsForSheet = async (orderNum: string, sheetNum: string) => {
    try {
      const logs: any[] = await api.getPhaseLogs();
      const locked = new Set<string>();
      let hasAnyNonDeletedLog = false;

      const isDeletedLog = (l: any) => {
        const pp = String(l.productionPosition ?? l.production_position ?? "").trim().toUpperCase();
        // treat delete markers as non-locking
        return pp === "DELETED";
      };

      for (const l of logs || []) {
        const o = String(l.orderNumber ?? l.order_number ?? "").trim();
        const s = String(l.productionSheetNumber ?? l.production_sheet_number ?? "").trim();
        if (o !== orderNum || s !== sheetNum) continue;

        if (isDeletedLog(l)) continue; // ✅ do NOT lock from deleted phase logs

        hasAnyNonDeletedLog = true;

        const pos = String(l.position ?? "").trim();
        if (pos) locked.add(pos);
      }

      return { lockedPositions: Array.from(locked), materialsLocked: hasAnyNonDeletedLog };
    } catch {
      return { lockedPositions: [], materialsLocked: false };
    }
  };


  const confirmTargetSheet = async () => {
    if (!orderLocked || mode !== "update") return;
    if (!orderNumber.trim() || !targetSheetNumber.trim()) return;

    setIsLoading(true);
    try {
      const orderNum = orderNumber.trim();
      const sheetNum = targetSheetNumber.trim();

      const sheet: any = await api.getProductionSheetForOrder(orderNum, sheetNum);

      const snap = sheet.productSnapshot || null;
      const qty = Number(sheet.quantity || 0);

      const base = snap
        ? {
            id: snap.id || sheet.productId,
            name: snap.name || (snap.id || sheet.productId),
            materials: Array.isArray(snap.materials) ? snap.materials : [],
            phases: Array.isArray(snap.phases) ? snap.phases : [],
          }
        : (() => {
            const p = existingProducts.find((x) => x.id === sheet.productId);
            return {
              id: p?.id || sheet.productId,
              name: p?.name || sheet.productId,
              materials: p?.materials || [],
              phases: p?.phases || [],
            };
          })();

      const locks = await getLockedPositionsForSheet(orderNum, sheetNum);

      const productDef: ProductDefWithMeta = {
        id: base.id,
        name: base.name,
        quantity: qty,
        __lockedPositions: locks.lockedPositions,
        __materialsLocked: locks.materialsLocked,
        materials: (base.materials || []).map((m: any, i: number) => {
          const qpp = Number(m.quantityPerPiece ?? 0);
          const total = Number(m.totalQuantity ?? qpp * qty);
          return {
            materialId: m.materialId,
            quantityPerPiece: qty > 0 ? total / qty : 0,
            totalQuantity: total,
            position: String(m.position ?? (i + 1) * 10),
          };
        }),
        phases: ensurePhaseUids(base.phases || []).map((p: any, i: number) => {
          const prodPerPiece = Number(p.productionTimePerPiece ?? 0);
          const totalProd = Number(p.totalProductionTime ?? prodPerPiece * qty);
          const setup = Number(p.totalSetupTime ?? p.setupTime ?? 0);
          const fallbackPos = String(p.position ?? ((base.materials?.length || 0) + i + 1) * 10);
          return {
            ...p,
            __uid: p.__uid || makeUid(),
            __deleted: String(p.phaseId || "").trim() === "",
            phaseId: p.phaseId,
            setupTime: setup,
            totalSetupTime: setup,
            productionTimePerPiece: qty > 0 ? totalProd / qty : 0,
            totalProductionTime: totalProd,
            position: fallbackPos,
            productionPosition: String(p.productionPosition ?? fallbackPos), // ✅ NEW
          };
        }),
      };

      setSheets([
        {
          number: sheet.productionSheetNumber,
          productId: sheet.productId,
          quantity: String(qty),
          productDef: productDef as any,
        },
      ]);

      setSheetLocked(true);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================
  // AUTO CONFIRM (no buttons)
  // ============================
  useEffect(() => {
    if (orderLocked) return;
    if (mode === "idle") return;

    const ord = orderNumber.trim();
    if (!ord) return;

    // avoid repeating the same confirm
    if (lastConfirmedOrderRef.current?.mode === mode && lastConfirmedOrderRef.current?.order === ord) {
      return;
    }

    const timer = window.setTimeout(async () => {
      // re-check inside debounce
      const ordNow = orderNumber.trim();
      if (lastConfirmedOrderRef.current?.mode === mode && lastConfirmedOrderRef.current?.order === ordNow) return;

      lastConfirmedOrderRef.current = { mode, order: ordNow };
      await confirmOrder();
    }, 600);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber, mode, orderLocked]);

  useEffect(() => {
    if (!orderLocked) return;
    if (mode !== "update") return;
    if (sheetLocked) return;

    const ord = orderNumber.trim();
    const sh = targetSheetNumber.trim();
    if (!ord || !sh) return;

    if (lastConfirmedSheetRef.current?.order === ord && lastConfirmedSheetRef.current?.sheet === sh) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const ordNow = orderNumber.trim();
      const shNow = targetSheetNumber.trim();
      if (!ordNow || !shNow || sheetLocked || mode !== "update") return;
      if (lastConfirmedSheetRef.current?.order === ordNow && lastConfirmedSheetRef.current?.sheet === shNow) return;

      lastConfirmedSheetRef.current = { order: ordNow, sheet: shNow };
      await confirmTargetSheet();
    }, 600);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderLocked, mode, sheetLocked, targetSheetNumber]);

  const handleToggleReprintSelection = (sheetId: string) => {
    setSelectedSheetsToReprint((prev) =>
      prev.includes(sheetId) ? prev.filter((id) => id !== sheetId) : [...prev, sheetId]
    );
  };

  const handlePrintSelected = (layout: "sticker" | "full") => {
    const toPrint = existingSheetsForReprint.filter((s) => selectedSheetsToReprint.includes(s.id));
    if (toPrint.length > 0) printSheets(toPrint, layout);
  };

  if (generatedSheets.length > 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">{t("header.title")}</h2>
        <p className="text-lg text-gray-600 mb-6">
          {t("orderkeeper.orderCompletePrompt").replace(" Print QR codes for all production sheets?", "")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => printSheets(generatedSheets, "sticker")}
            className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
          >
            {t("batchCreate.printStickerLayout")}
          </button>
          <button
            onClick={() => printSheets(generatedSheets, "full")}
            className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            {t("batchCreate.printFullBleedLayout")}
          </button>
        </div>
        <button onClick={() => setGeneratedSheets([])} className="mt-6 w-full max-w-xs text-indigo-600 hover:underline">
          {t("common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("orderkeeper.title")}</h2>

      {/* STEP 1: MODE */}
      <div className="mb-6 p-4 border rounded-md bg-gray-50">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">{t("orderkeeper.modeLabel")}</span>

            <label className="flex items-center gap-2">
              <input type="radio" disabled={orderLocked} checked={mode === "create"} onChange={() => setModeAndReset("create")} />
              <span>{t("orderkeeper.modes.create")}</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="radio" disabled={orderLocked} checked={mode === "update"} onChange={() => setModeAndReset("update")} />
              <span>{t("orderkeeper.modes.update")}</span>
            </label>

            <label className="flex items-center gap-2">
              <input type="radio" disabled={orderLocked} checked={mode === "reprint"} onChange={() => setModeAndReset("reprint")} />
              <span>{t("orderkeeper.modes.reprint")}</span>
            </label>
          </div>

          <button onClick={resetAll} className="btn-secondary">
            {orderLocked ? t("orderkeeper.changeMode") : t("common.reset")}
          </button>
        </div>
      </div>

      {/* STEP 2: ORDER NUMBER (auto-confirm) */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">{t("orderkeeper.orderNumber")}</label>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!orderLocked && mode !== "idle" && orderNumber.trim()) {
                  lastConfirmedOrderRef.current = { mode, order: orderNumber.trim() };
                  confirmOrder();
                }
              }
            }}
            placeholder={t("orderkeeper.orderNumberPlaceholder")}
            className="input-style flex-grow"
            disabled={mode === "idle" || orderLocked}
          />
        </div>
      </div>

      {/* STEP 2.5: SHEET NUMBER (update mode) (auto-confirm) */}
      {orderLocked && mode === "update" && !sheetLocked && (
        <div className="mb-6 p-4 border rounded-md bg-gray-50">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("orderkeeper.productionSheetNumberLabel")}</label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={targetSheetNumber}
              onChange={(e) => setTargetSheetNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (targetSheetNumber.trim()) {
                    lastConfirmedSheetRef.current = { order: orderNumber.trim(), sheet: targetSheetNumber.trim() };
                    confirmTargetSheet();
                  }
                }
              }}
              placeholder={t("orderkeeper.sheetNumber")}
              className="input-style flex-grow"
            />
          </div>
        </div>
      )}

      {isLoading && <div className="text-center p-4">{t("common.loading")}</div>}

      {/* CREATE / UPDATE UI */}
      {canProceed && (mode === "create" || mode === "update") && (
        <>
          <h3 className="text-xl font-semibold text-gray-700 mb-4 border-t pt-4">
            {mode === "create" ? t("orderkeeper.productionSheets") : t("orderkeeper.editTitle")}
          </h3>

          {sheets.map((sheet, i) => {
            const meta = sheet.productDef as any as ProductDefWithMeta;
            const lockedPositions = meta.__lockedPositions || [];
            const materialsLocked = !!meta.__materialsLocked;

            return (
              <div key={i} className="p-4 border rounded-md mb-4 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input
                    type="text"
                    placeholder={t("orderkeeper.sheetNumber")}
                    value={sheet.number}
                    onChange={(e) => updateSheet(i, "number", e.target.value)}
                    className="input-style"
                    disabled={mode === "update"}
                  />

                  <input
                    list="product-ids"
                    placeholder={t("orderkeeper.productId")}
                    value={sheet.productId}
                    onChange={(e) => updateSheet(i, "productId", e.target.value)}
                    className="input-style"
                  />
                  <datalist id="product-ids">
                    {existingProducts.map((p) => (
                      <option key={p.id} value={p.id} />
                    ))}
                  </datalist>

                  <input
                    type="number"
                    placeholder={t("orderkeeper.quantity")}
                    value={sheet.quantity}
                    onChange={(e) => updateSheet(i, "quantity", e.target.value)}
                    className="input-style"
                  />
                </div>

                {sheet.productId && (
                  <ProductDefinition
                    product={sheet.productDef}
                    updateProduct={(p) => updateSheet(i, "productDef", p)}
                    phasesList={phasesList}
                    autoPositioning={mode !== "update"}
                    showPhasePosition={mode === "update"}
                    lockedPositions={lockedPositions}
                    materialsLocked={mode === "update" ? materialsLocked : false}
                    onPhaseDeleted={createDeletedPhaseLog} // ✅ NEW
                  />
                )}
              </div>
            );
          })}

          <div className="flex gap-3 mt-4">
            {mode === "create" && (
              <button onClick={() => addSheet()} className="btn-secondary">
                {t("orderkeeper.addSheet")}
              </button>
            )}

            <button onClick={handleSave} disabled={isSaving} className="btn-primary">
              {isSaving ? t("orderkeeper.saving") : t("orderkeeper.saveOrder")}
            </button>
          </div>
        </>
      )}

      {/* REPRINT UI */}
      {canProceed && mode === "reprint" && (
        <div className="border-t pt-4">
          <h3 className="text-xl font-semibold text-gray-700 mb-4">{t("orderkeeper.reprintTitle", { orderNumber })}</h3>

          {existingSheetsForReprint.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          onChange={(e) =>
                            setSelectedSheetsToReprint(e.target.checked ? existingSheetsForReprint.map((s) => s.id) : [])
                          }
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.sheetNumberHeader")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.productIdHeader")}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {t("orderkeeper.quantityHeader")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {existingSheetsForReprint.map((sheet) => (
                      <tr key={sheet.id}>
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedSheetsToReprint.includes(sheet.id)}
                            onChange={() => handleToggleReprintSelection(sheet.id)}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sheet.productionSheetNumber}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.productId}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 p-4 border rounded-md bg-gray-50">
                <h4 className="text-md font-semibold text-gray-700 mb-3">{t("orderkeeper.printOptions")}</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      {t("orderkeeper.printSelected")} ({selectedSheetsToReprint.length} {t("orderkeeper.selectedCountSuffix")})
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handlePrintSelected("sticker")}
                        disabled={selectedSheetsToReprint.length === 0}
                        className="btn-primary text-sm"
                      >
                        {t("batchCreate.printStickerLayout")}
                      </button>
                      <button
                        onClick={() => handlePrintSelected("full")}
                        disabled={selectedSheetsToReprint.length === 0}
                        className="btn-secondary text-sm"
                      >
                        {t("batchCreate.printFullBleedLayout")}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      {t("orderkeeper.printAll")} ({existingSheetsForReprint.length} {t("orderkeeper.totalCountSuffix")})
                    </p>
                    <div className="flex flex-col gap-2">
                      <button onClick={() => printSheets(existingSheetsForReprint, "sticker")} className="btn-primary text-sm">
                        {t("batchCreate.printStickerLayout")}
                      </button>
                      <button onClick={() => printSheets(existingSheetsForReprint, "full")} className="btn-secondary text-sm">
                        {t("batchCreate.printFullBleedLayout")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray-500">{t("orderkeeper.noSheetsFound")}</p>
          )}
        </div>
      )}

      <style>{`
        .input-style { display: block; width: 100%; padding: 0.5rem; border-radius: 0.375rem; border: 1px solid #D1D5DB; }
        .btn-primary { padding: 0.5rem 1rem; background-color: #4F46E5; color: white; border-radius: 0.375rem; font-weight: 500; }
        .btn-primary:hover { background-color: #4338CA; }
        .btn-primary:disabled { background-color: #A5B4FC; cursor: not-allowed; }
        .btn-secondary { padding: 0.5rem 1rem; background-color: #E5E7EB; color: #374151; border-radius: 0.375rem; font-weight: 500; }
        .btn-secondary:hover { background-color: #D1D5DB; }
        .btn-secondary:disabled { background-color: #F3F4F6; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

export default OrderKeeperView;
