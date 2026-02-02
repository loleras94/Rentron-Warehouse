import React, { useState, useEffect, useContext } from "react";
import type { Material, QrData, ActionType } from "../src/types";
import { useWarehouse } from "../hooks/useWarehouse";
import Scanner from "./Scanner";
import ActionModal from "./ActionModal";
import { CameraIcon } from "./Icons";
import { useTranslation } from "../hooks/useTranslation";
import { AuthContext } from "../context/AuthContext";
import * as api from "../api/client";

const OperatorView: React.FC = () => {
  const [scannedData, setScannedData] = useState<QrData | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [action, setAction] = useState<ActionType | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Quantity adjust UI (warehouse manager only)
  const [isAdjustingQty, setIsAdjustingQty] = useState(false);
  const [newQty, setNewQty] = useState<string>("");

  // New state for other entities with same SKU and location details
  const [otherEntities, setOtherEntities] = useState<Material[]>([]);

  const [isSavingQty, setIsSavingQty] = useState(false);

  const { findMaterialById, findMaterialByIdOnline } = useWarehouse();
  const { t } = useTranslation();

  const auth = useContext(AuthContext);
  const isWarehouseManager =
    !!auth?.user?.roles?.some(r => r === "warehousemanager" || r === "manager");
  const hasLocation = material?.location !== null && material?.location !== undefined;

  useEffect(() => {
    if (!scannedData) return;

    let cancelled = false;

    (async () => {
      // 1) ALWAYS fetch from backend first (fresh DB data)
      let foundMaterial = await findMaterialByIdOnline(scannedData.id);

      // 2) If backend fails (offline/etc), fallback to local cache
      if (!foundMaterial) {
        foundMaterial = findMaterialById(scannedData.id);
      }

      if (cancelled) return;

      if (foundMaterial) {
        if (foundMaterial.currentQuantity > 0) {
          setMaterial(foundMaterial);
          setError(null);

          // Fetch other materials with the same SKU if manager or warehouse manager
          if (isWarehouseManager) {
            // Query materials with the same SKU, excluding the currently scanned material
            const materialsWithSameSku = await api.searchMaterials(foundMaterial.materialCode, false);
            const filteredMaterials = materialsWithSameSku.filter(
              (mat) => mat.id !== foundMaterial.id // Exclude the current material
            );
            setOtherEntities(filteredMaterials);
          }
        } else {
          setError(
            t("operator.materialConsumedError", {
              materialCode: foundMaterial.materialCode,
              id: foundMaterial.id,
            })
          );
          setMaterial(null);
        }
      } else {
        setError(t("operator.materialNotFoundError"));
        setMaterial(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scannedData, refreshKey, findMaterialByIdOnline, findMaterialById, t, isWarehouseManager]);

  const handleScanSuccess = (decodedText: string) => {
    try {
      const data = JSON.parse(decodedText) as QrData;
      if (data.id && data.materialCode && data.quantity !== undefined) {
        setScannedData(data);
        setIsScanning(false);
      } else {
        handleScanError(t("operator.scanErrorInvalidFormat"));
      }
    } catch {
      handleScanError(t("operator.scanErrorParseFailed"));
    }
  };

  const handleScanError = (errorMessage: string) => {
    setError(errorMessage);
    setIsScanning(false);
  };

  const reset = () => {
    setScannedData(null);
    setMaterial(null);
    setError(null);
    setIsScanning(false);
    setAction(null);

    setIsAdjustingQty(false);
    setNewQty("");
    setIsSavingQty(false);

    setOtherEntities([]); // Reset other entities
  };

  const handleActionComplete = () => {
    reset();
  };

  const openAdjustQty = () => {
    if (!material) return;
    setNewQty(String(material.currentQuantity ?? ""));
    setIsAdjustingQty(true);
  };

  const closeAdjustQty = () => {
    setIsAdjustingQty(false);
    setNewQty("");
    setIsSavingQty(false);
  };

  const saveAdjustedQty = async () => {
    if (!material) return;

    const parsed = Number(newQty);
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert(t("operator.invalidQuantity"));
      return;
    }

    const delta = parsed - Number(material.currentQuantity || 0);

    setIsSavingQty(true);
    try {
      await api.adjustMaterialQuantity(material.id, delta, "MANUAL_ADJUST");

      // ✅ reload from backend so you get full merged history
      const fresh = await findMaterialByIdOnline(material.id);
      if (fresh) setMaterial(fresh);

      setRefreshKey((k) => k + 1);

      alert(t("operator.quantityUpdated"));
      closeAdjustQty();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || t("operator.quantityUpdateFailed"));
    } finally {
      setIsSavingQty(false);
    }
  };

  if (isScanning) {
    return (
      <div className="max-w-xl mx-auto">
        <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
        <button
          onClick={() => setIsScanning(false)}
          className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
        >
          {t("operator.cancelScanButton")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-700 mb-4">{t("operator.title")}</h2>

      {!material ? (
        <div>
          <p className="text-gray-600 mb-4">{t("operator.scanPrompt")}</p>
          <button
            onClick={() => {
              reset();
              setIsScanning(true);
            }}
            className="w-full flex justify-center items-center py-3 px-4 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <CameraIcon className="w-5 h-5 mr-2" />
            {t("operator.startScannerButton")}
          </button>
          {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
        </div>
      ) : (
        <div key={refreshKey}>
          <h3 className="text-xl font-semibold text-gray-800">
            {t("operator.materialDetailsTitle")}
          </h3>

          <div className="mt-4 space-y-2 text-gray-700 bg-gray-50 p-4 rounded-md">
            <p>
              <strong>{t("operator.materialCode")}:</strong>{" "}
              <span className="font-mono bg-gray-200 px-2 py-1 rounded">
                {material.materialCode}
              </span>
            </p>
            <p>
              <strong>{t("operator.remainingQuantity")}:</strong>{" "}
              {material.currentQuantity} / {material.initialQuantity}
            </p>
            <p>
              <strong>{t("common.location")}:</strong>{" "}
              {material && material.location
                ? `${material.location.area}, Position ${material.location.position}`
                : t("common.na")}
            </p>
          </div>

          {/* New section for warehouse managers */}
          {isWarehouseManager && otherEntities.length > 0 && (
            <div className="mt-4 space-y-2 text-gray-700 bg-gray-50 p-4 rounded-md">
              <h4 className="text-lg font-semibold text-gray-700">{t("operator.sameSkuEntities")}</h4>
              <ul className="list-disc pl-5">
                {otherEntities.map((entity) => (
                  <li key={entity.id}>
                    {entity.materialCode}: {entity.currentQuantity}{" "}
                    ({entity.location?.area} - {entity.location?.position})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6">
            <h4 className="font-semibold mb-3">{t("operator.chooseAction")}:</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => setAction("CONSUMPTION")}
                className="bg-red-500 text-white py-3 px-4 rounded-md hover:bg-red-600"
                disabled={!hasLocation}
              >
                {t("operator.fullConsumption")}
              </button>

              <button
                onClick={() => setAction("PLACEMENT")}
                className="bg-blue-500 text-white py-3 px-4 rounded-md hover:bg-blue-600"
                disabled={hasLocation}
              >
                {t("operator.placement")}
              </button>

              <button
                onClick={() => setAction("MOVEMENT")}
                className="bg-yellow-500 text-white py-3 px-4 rounded-md hover:bg-yellow-600"
                disabled={!hasLocation}
              >
                {t("operator.movement")}
              </button>

              <button
                onClick={() => setAction("PARTIAL_CONSUMPTION")}
                className="bg-green-500 text-white py-3 px-4 rounded-md hover:bg-green-600"
                disabled={!hasLocation}
              >
                {t("operator.partialConsumption")}
              </button>

              {isWarehouseManager && (
                <button
                  onClick={openAdjustQty}
                  className="bg-gray-800 text-white py-3 px-4 rounded-md hover:bg-black md:col-span-2"
                >
                  {t("operator.adjustQuantity")}
                </button>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-2 text-center">
              {t("operator.actionsDisabledHint")}
            </p>
          </div>

          <button
            onClick={reset}
            className="mt-6 w-full text-indigo-600 hover:text-indigo-800 font-medium"
          >
            {t("operator.scanAnother")}
          </button>
        </div>
      )}

      {action && material && (
        <ActionModal
          actionType={action}
          material={material}
          onClose={() => setAction(null)}
          onComplete={handleActionComplete}
        />
      )}

      {isAdjustingQty && material && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-lg shadow-lg p-5">
            <h3 className="text-lg font-bold text-gray-800 mb-3">
              {t("operator.adjustQuantityTitle")}
            </h3>

            <div className="text-sm text-gray-700 mb-3">
              <div>
                <b>{t("operator.materialCode")}:</b>{" "}
                <span className="font-mono">{material.materialCode}</span>
              </div>
              <div>
                <b>{t("operator.remainingQuantity")}:</b> {material.currentQuantity}
              </div>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("operator.newTotalQuantity")}
            </label>
            <input
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              inputMode="numeric"
            />

            <div className="mt-4 flex gap-2">
              <button
                onClick={closeAdjustQty}
                disabled={isSavingQty}
                className="flex-1 py-2 rounded-md border border-gray-300 text-gray-700 disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>

              <button
                onClick={saveAdjustedQty}
                disabled={isSavingQty}
                className="flex-1 py-2 rounded-md text-white bg-indigo-600 disabled:bg-indigo-400"
              >
                {isSavingQty ? t("common.saving") : t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperatorView;
