import React, { useState, useEffect, useMemo } from "react";
import { SearchIcon, QrCodeIcon } from "./Icons";
import QrCodeModal from "./QrCodeModal";
import type { Material, HistoryEvent } from "../src/types";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";

const SearchView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<Material[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [materialForQr, setMaterialForQr] = useState<Material | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ checkbox: default false => hide fully consumed
  const [includeConsumed, setIncludeConsumed] = useState(false);

  const { t } = useTranslation();

  /* ============================================================
     BACKEND SEARCH — always fresh
     ============================================================ */
  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      setResults([]);
      return;
    }

    let active = true;
    setLoading(true);

    api
      .searchMaterials(term, includeConsumed)
      .then((res) => {
        if (active) setResults(res);
      })
      .catch((err) => {
        console.error("Search request failed:", err);
        if (active) setResults([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [searchTerm, includeConsumed]);

  /* ============================================================
     UI Helpers
     ============================================================ */
  const toggleHistory = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatTimestamp = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const renderHistoryDetails = (
    details: Record<string, any>,
    type: HistoryEvent["type"]
  ) => {
    switch (type) {
      case "CREATED":
        return t("search.historyDetails.quantity", {
          quantity: details.quantity,
        });

      case "PLACED":
        return t("search.historyDetails.placedTo", {
          area: details.to.area,
          position: details.to.position,
        });

      case "MOVED":
        return t("search.historyDetails.movedFromTo", {
          fromArea: details.from?.area,
          fromPosition: details.from?.position,
          toArea: details.to.area,
          toPosition: details.to.position,
        });

      case "CONSUMED":
        return t("search.historyDetails.consumed", {
          productionCode: details.productionCode,
          consumed: details.consumed,
        });

      case "PARTIALLY_CONSUMED":
        return t("search.historyDetails.partiallyConsumed", {
          productionCode: details.productionCode,
          consumed: details.consumed,
          remaining: details.remaining,
          newLocationArea: details.newLocation?.area,
          newLocationPosition: details.newLocation?.position,
        });
      case "ADJUSTED": {
        const fromQty = details?.fromQty ?? details?.from_qty;
        const toQty = details?.toQty ?? details?.to_qty;
        const delta = details?.delta;

        const parts = [];
        if (fromQty != null && toQty != null) {
          parts.push(t("search.historyDetails.adjustedFromTo", {
            fromQty,
            toQty,
          }));
        } else {
          // fallback if backend didn't send both
          parts.push(t("search.historyDetails.adjusted", { delta }));
        }
        return parts.join(" ");
      }

      default:
        return JSON.stringify(details);
    }
  };

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold text-gray-700 mb-4">
          {t("search.title", {})}
        </h2>

        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("search.placeholder", {})}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg
                       focus:ring-indigo-500 focus:border-indigo-500"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon className="h-5 w-5 text-gray-400" />
          </div>
        </div>

        {/* ✅ Checkbox */}
        <div className="mt-3 flex items-center gap-2">
          <input
            id="include-consumed"
            type="checkbox"
            checked={includeConsumed}
            onChange={(e) => setIncludeConsumed(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="include-consumed" className="text-sm text-gray-700">
            {t("search.showConsumed", {})}
          </label>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6 space-y-4">
        {loading && searchTerm ? (
          <div className="text-center text-gray-500 mt-8">
            {t("search.loading", {})}
          </div>
        ) : results.length > 0 ? (
          results.map((material) => (
            <div
              key={material.id}
              className="bg-white rounded-lg shadow-md overflow-hidden"
            >
              <div className="p-4 flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div>
                  <p className="font-bold text-lg text-indigo-700">
                    {material.materialCode}
                  </p>
                </div>

                <div className="text-left md:text-right">
                  <p
                    className={`text-sm ${
                      material.currentQuantity > 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    <span className="font-semibold">
                      {t("common.quantity", {})}:
                    </span>{" "}
                    {material.currentQuantity} / {material.initialQuantity}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold">
                      {t("common.location", {})}:
                    </span>{" "}
                    {material.location
                      ? `${material.location.area}, Pos ${material.location.position}`
                      : t("common.na", {})}
                  </p>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2 self-start md:self-center">
                  <button
                    onClick={() => toggleHistory(material.id)}
                    className="py-2 px-3 text-sm font-medium rounded-md
                               text-indigo-600 hover:bg-indigo-50 transition-colors"
                  >
                    {expandedId === material.id
                      ? t("search.hideHistory", {})
                      : t("search.showHistory", {})}
                  </button>

                  <button
                    onClick={() => setMaterialForQr(material)}
                    className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                    title={t("search.showQrCode", {})}
                  >
                    <QrCodeIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* History */}
              {expandedId === material.id && (
                <div className="bg-gray-50 p-4 border-t border-gray-200">
                  <h4 className="font-semibold mb-2 text-gray-700">
                    {t("search.historyTitle", {})}
                  </h4>
                  <ul className="space-y-2 text-sm">
                    {material.history
                      .slice()
                      .reverse()
                      .map((event, index) => (
                        <li
                          key={index}
                          className="p-2 bg-white rounded-md border border-gray-200"
                        >
                          <p className="font-semibold text-gray-800">
                            {t(`search.historyType.${event.type}`, {})}
                          </p>
                          <p className="text-gray-500">
                            {formatTimestamp(event.timestamp)} ·{" "}
                            <span className="font-medium">{t("transactions.table.user")}:</span>{" "}
                            {event.details?.user || "—"}
                          </p>
                          <p className="text-gray-600 mt-1">
                            {renderHistoryDetails(event.details, event.type)}
                          </p>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        ) : (
          searchTerm && (
            <p className="text-center text-gray-500 mt-8">
              {includeConsumed
                ? t("search.noResults", { searchTerm })
                : t("search.noAvailableResults", { searchTerm })}
            </p>
          )
        )}
      </div>

      {/* QR Modal */}
      {materialForQr && (
        <QrCodeModal
          material={materialForQr}
          onClose={() => setMaterialForQr(null)}
        />
      )}
    </div>
  );
};

export default SearchView;
