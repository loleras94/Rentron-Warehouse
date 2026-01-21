import React, { useMemo, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { MaterialUseUnit, ProductionSheetForOperator } from "../src/types";
import Scanner from "./Scanner";

const UNITS: MaterialUseUnit[] = ["KG", "m", "cm", "pcs", "other"];

function dedupe(arr: string[]) {
  const s = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (s.has(v)) continue;
    s.add(v);
    out.push(v);
  }
  return out;
}

const MaterialUseView: React.FC = () => {
  const { t } = useTranslation();

  const [entryType, setEntryType] = useState<"product_sheet" | "sample">(
    "product_sheet"
  );

  const [sheet, setSheet] = useState<ProductionSheetForOperator | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);

  // ✅ use same scanning logic as OperatorView
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // option
  const [source, setSource] = useState<"sheet" | "manual" | "remnant">(
    "remnant"
  );

  // inputs
  const [materialCode, setMaterialCode] = useState("");
  const [qty, setQty] = useState<string>("");
  const [unit, setUnit] = useState<MaterialUseUnit>("KG");

  const materialOptionsFromSheet = useMemo(() => {
    if (!sheet?.product?.materials) return [];
    const codes = sheet.product.materials.map((m: any) =>
      String(m.materialId ?? m.material_id ?? "").trim()
    );
    return dedupe(codes);
  }, [sheet]);

  const canUseSheetSource = entryType === "product_sheet" && !!sheet;

  const resetForm = () => {
    setSheet(null);
    setSource("remnant");
    setMaterialCode("");
    setQty("");
    setUnit("KG");
    setScanError(null);
    setIsScanning(false);
  };

  const loadSheetByQr = async (payload: string) => {
    const text = String(payload || "").trim();
    if (!text) return;

    setLoadingSheet(true);
    try {
      const s = await api.getProductionSheetByQr(text);
      setSheet(s);

      // default source after scan: "sheet"
      setSource("sheet");

      // auto-select first material if exists
      const opts = dedupe(
        (s.product?.materials || []).map((m: any) =>
          String(m.materialId ?? m.material_id ?? "").trim()
        )
      );
      if (opts[0]) setMaterialCode(opts[0]);

      setScanError(null);
      setIsScanning(false);
    } catch (e: any) {
      console.error(e);
      setSheet(null);
      setScanError(e?.message || t("materialUse.qr.errors.loadFailed"));
      setIsScanning(false);
    } finally {
      setLoadingSheet(false);
    }
  };

  // ✅ Scanner callbacks (same style as OperatorView)
  const handleScanSuccess = async (decodedText: string) => {
    // For OperatorView you JSON.parse; here we use the raw QR payload as-is
    await loadSheetByQr(decodedText);
  };

  const handleScanError = (errMsg: string) => {
    setScanError(errMsg || t("materialUse.qr.errors.loadFailed"));
    setIsScanning(false);
  };

  const handleSubmit = async () => {
    try {
      // Enforce rules on frontend too
      if (entryType === "sample" && source === "sheet") {
        return alert(t("materialUse.errors.sampleCannotUseSheet"));
      }
      if (entryType === "product_sheet" && !sheet && source !== "remnant") {
        return alert(t("materialUse.errors.scanFirst"));
      }

      if (source === "sheet") {
        if (!sheet?.productionSheetNumber)
          return alert(t("materialUse.errors.missingSheetNumber"));
        if (!materialCode.trim())
          return alert(t("materialUse.errors.selectMaterial"));
        if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0)
          return alert(t("materialUse.errors.qtyPositive"));

        await api.createMaterialUseLog({
          entryType,
          productionSheetNumber: sheet.productionSheetNumber,
          source: "sheet",
          materialCode: materialCode.trim(),
          quantity: Number(qty),
          unit,
        });
      }

      if (source === "manual") {
        if (!materialCode.trim())
          return alert(t("materialUse.errors.enterMaterialCode"));
        if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0)
          return alert(t("materialUse.errors.qtyPositive"));

        await api.createMaterialUseLog({
          entryType,
          productionSheetNumber: sheet?.productionSheetNumber,
          source: "manual",
          materialCode: materialCode.trim(),
          quantity: Number(qty),
          unit,
        });
      }

      if (source === "remnant") {
        await api.createMaterialUseLog({
          entryType,
          productionSheetNumber: sheet?.productionSheetNumber,
          source: "remnant",
        });
      }

      alert(t("materialUse.saved"));
      resetForm();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || t("materialUse.errors.saveFailed"));
    }
  };

  // If sample, force source away from sheet
  const handleEntryTypeChange = (v: "product_sheet" | "sample") => {
    setEntryType(v);
    setSheet(null);
    setScanError(null);
    setIsScanning(false);
    if (v === "sample" && source === "sheet") setSource("remnant");
  };

  // ✅ If scanning mode, show Scanner full-screen like OperatorView
  if (isScanning) {
    return (
      <div className="max-w-xl mx-auto">
        <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
        <button
          onClick={() => setIsScanning(false)}
          className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
        >
          {t("materialUse.qr.stopCamera")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("materialUse.title")}
      </h2>

      {/* Entry type */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("materialUse.registerFor")}
        </label>

        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={entryType === "product_sheet"}
              onChange={() => handleEntryTypeChange("product_sheet")}
            />
            {t("materialUse.entryType.productionSheet")}
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={entryType === "sample"}
              onChange={() => handleEntryTypeChange("sample")}
            />
            {t("materialUse.entryType.sample")}
          </label>
        </div>
      </div>

      {/* Scan product sheet QR (camera only) */}
      {entryType === "product_sheet" && (
        <div className="mb-4 p-4 border rounded-md">
          <div className="text-sm font-medium text-gray-700 mb-2">
            {t("materialUse.qr.title")}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setScanError(null);
                setSheet(null);
                setIsScanning(true);
              }}
              className="px-4 py-2 rounded-md text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60"
              disabled={loadingSheet}
            >
              {loadingSheet ? t("materialUse.qr.loading") : t("materialUse.qr.scanWithCamera")}
            </button>

            {sheet && (
              <button
                onClick={() => {
                  setSheet(null);
                  setSource("remnant");
                  setMaterialCode("");
                }}
                className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {t("common.clear")}
              </button>
            )}
          </div>

          {scanError && (
            <div className="text-xs text-red-600 mt-3">{scanError}</div>
          )}

          {sheet && (
            <div className="mt-3 text-sm text-gray-700">
              <div>
                <b>{t("materialUse.sheetInfo.sheet")}:</b>{" "}
                {sheet.productionSheetNumber}
              </div>
              <div>
                <b>{t("materialUse.sheetInfo.product")}:</b> {sheet.productId}
              </div>
              <div>
                <b>{t("materialUse.sheetInfo.qty")}:</b> {sheet.quantity}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("materialUse.materialOption")}
        </label>

        <select
          value={source}
          onChange={(e) => setSource(e.target.value as any)}
          className="w-full px-3 py-2 border rounded-md"
        >
          {entryType === "product_sheet" && (
            <option value="sheet" disabled={!canUseSheetSource}>
              {t("materialUse.source.sheet")}
            </option>
          )}
          <option value="remnant">{t("materialUse.source.remnant")}</option>
          <option value="manual">{t("materialUse.source.manual")}</option>
        </select>

        {entryType === "product_sheet" && source === "sheet" && !sheet && (
          <div className="text-xs text-red-600 mt-1">
            {t("materialUse.errors.loadSheetToUseSheetMaterials")}
          </div>
        )}
      </div>

      {/* Inputs based on source */}
      {(source === "sheet" || source === "manual") && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("materialUse.fields.material")}
            </label>

            {source === "sheet" ? (
              <select
                value={materialCode}
                onChange={(e) => setMaterialCode(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
                disabled={!sheet}
              >
                <option value="">{t("materialUse.fields.selectMaterial")}</option>
                {materialOptionsFromSheet.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={materialCode}
                onChange={(e) => setMaterialCode(e.target.value)}
                placeholder={t("materialUse.fields.materialPlaceholder")}
                className="w-full px-3 py-2 border rounded-md"
              />
            )}
          </div>

          <div className="sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("materialUse.fields.quantity")}
            </label>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={t("materialUse.fields.quantityPlaceholder")}
              className="w-full px-3 py-2 border rounded-md"
              inputMode="decimal"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("materialUse.fields.unit")}
            </label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as MaterialUseUnit)}
              className="w-full px-3 py-2 border rounded-md"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        className="w-full py-2 rounded-md text-white bg-green-600"
      >
        {t("materialUse.saveEntry")}
      </button>
    </div>
  );
};

export default MaterialUseView;
