import React, { useMemo, useState } from "react";
import { useWarehouse } from "../hooks/useWarehouse";
import { QRCodeSVG } from "qrcode.react";
import type { Material, QrData } from "../src/types";
import { renderToStaticMarkup } from "react-dom/server";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";

type ParsedMaterialsPdf = { materials: string[] };

const BatchCreateView: React.FC = () => {
  const { addMaterial, refresh } = useWarehouse();
  const { t } = useTranslation();

  /**
   * ✅ Safe translation helper:
   * - t(key, varsObject) is the only valid call signature
   * - If key missing (t returns key or empty), use fallback
   * - Supports {{var}} interpolation in fallback
   */
  const tr = (
    key: string,
    fallback: string,
    vars: Record<string, string | number> = {}
  ) => {
    let out = "";
    try {
      out = t(key, vars) as unknown as string;
    } catch {
      out = "";
    }

    const isMissing = !out || out === key;

    if (isMissing) {
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
    }
    return out;
  };

  // Manual entries (and also used for parsed results)
  const [entries, setEntries] = useState<{ code: string; qty: string }[]>([
    { code: "", qty: "" },
  ]);

  // ✅ MULTI PDF import state
  const [files, setFiles] = useState<File[]>([]);
  const [parsedMaterials, setParsedMaterials] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseErrorsByFile, setParseErrorsByFile] = useState<
    { fileName: string; message: string }[]
  >([]);

  // Save/print state
  const [newMaterials, setNewMaterials] = useState<Material[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddRow = () => setEntries((prev) => [...prev, { code: "", qty: "" }]);

  const handleChange = (i: number, field: "code" | "qty", value: string) => {
    setEntries((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: value };
      return copy;
    });
  };

  // --- PDF IMPORT (MULTI) ---
  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParsedMaterials([]);
    setParseError(null);
    setParseErrorsByFile([]);

    const list = Array.from(e.target.files || []);
    setFiles(list);
  };

  const normalizeUniquePreserveOrder = (arr: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const v = String(raw || "").trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };

  const handleParsePdf = async () => {
    if (files.length === 0) return;

    setIsParsing(true);
    setParseError(null);
    setParseErrorsByFile([]);
    setParsedMaterials([]);

    try {
      const results = await Promise.allSettled(
        files.map((f) => api.parseMaterialsPdf(f) as Promise<ParsedMaterialsPdf>)
      );

      const allCodes: string[] = [];
      const perFileErrors: { fileName: string; message: string }[] = [];

      results.forEach((r, idx) => {
        const fileName = files[idx]?.name || `PDF ${idx + 1}`;

        if (r.status === "fulfilled") {
          const mats = Array.isArray(r.value?.materials) ? r.value.materials : [];
          allCodes.push(...mats);

          if (mats.length === 0) {
            perFileErrors.push({
              fileName,
              message: tr(
                "batchCreate.pdf.noMaterialsFound",
                "No materials found in this PDF."
              ),
            });
          }
        } else {
          perFileErrors.push({
            fileName,
            message:
              (r.reason as any)?.message ||
              tr("batchCreate.pdf.parseFailed", "Failed to parse PDF."),
          });
        }
      });

      const unique = normalizeUniquePreserveOrder(allCodes);

      if (unique.length === 0) {
        setParseError(
          tr(
            "batchCreate.pdf.noMaterialsInAll",
            "No material codes found in the selected PDFs."
          )
        );
        setParseErrorsByFile(perFileErrors);
        return;
      }

      setParsedMaterials(unique);
      setParseErrorsByFile(perFileErrors);

      // Merge into entries without losing existing qty
      setEntries((prev) => {
        const cleanedPrev = prev.length === 0 ? [{ code: "", qty: "" }] : prev;
        const existingCodes = new Set(
          cleanedPrev.map((e) => e.code.trim()).filter(Boolean)
        );

        const toAdd = unique
          .filter((code) => !existingCodes.has(code))
          .map((code) => ({ code, qty: "" }));

        return [...cleanedPrev, ...toAdd];
      });
    } catch (e: any) {
      console.error(e);
      setParseError(e?.message || tr("batchCreate.pdf.parseFailed", "Failed to parse PDF."));
    } finally {
      setIsParsing(false);
    }
  };

  const clearParsed = () => {
    setFiles([]);
    setParsedMaterials([]);
    setParseError(null);
    setParseErrorsByFile([]);
  };

  // --- SAVE ---
  const validEntries = useMemo(() => {
    return entries.filter((e) => e.code.trim() && e.qty.trim() && Number(e.qty) > 0);
  }, [entries]);

  const handleSaveAll = async () => {
    setIsSaving(true);
    setNewMaterials([]);
    const created: Material[] = [];

    const valid = entries.filter((e) => e.code.trim() && e.qty.trim() && Number(e.qty) > 0);

    for (const e of valid) {
      try {
        const material = await addMaterial(e.code.trim(), Number(e.qty));
        created.push(material);
      } catch (error) {
        console.error(`Failed to create material ${e.code}:`, error);

        alert(
          tr(
            "batchCreate.saveRowFailed",
            "Failed to create material {{code}}. It might already exist or there was a server error.",
            { code: e.code }
          )
        );
      }
    }

    await refresh();
    setNewMaterials(created);
    setEntries([{ code: "", qty: "" }]);
    clearParsed();
    setIsSaving(false);
  };

  // --- PRINT ---
  const handlePrintAll = (materials: Material[], mode: "sticker" | "full") => {
    const totalCells = 24;
    const filled = [...materials];
    while (filled.length < totalCells) filled.push(null as any);

    const printWindow = window.open("", "", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Labels</title>
          <meta name="description" content="QR Sticker Sheet">
          <style>
            @page { size: A4 portrait; margin: 0; }
            @media print { body { -webkit-print-color-adjust: exact; } }
            html, body { margin: 0 !important; padding: 0 !important; background: white; }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              text-align: center;
              font-family: sans-serif;
            }
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
              width: 70mm;
              height: ${cellHeight}mm;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              overflow: hidden;
            }
            svg { width: 20mm; height: 20mm; }
            .cell p { margin: 1px 0; font-size: 9px; line-height: 1.1; }
          </style>

          <script>
            (function() {
              const isChrome = navigator.userAgent.toLowerCase().includes('chrome');
              const warned = localStorage.getItem('qrprint_warned');
              if (isChrome && !warned) {
                alert('IMPORTANT: For perfect alignment in Chrome, disable "Headers and footers" in the print settings dialog.');
                localStorage.setItem('qrprint_warned', '1');
              }
            })();
          </script>
        </head>
        <body>
          <div class="page">
    `);

    filled.forEach((m) => {
      if (m) {
        const qrValue = JSON.stringify({
          id: m.id,
          materialCode: m.materialCode,
          quantity: m.initialQuantity,
        });
        const svg = renderToStaticMarkup(<QRCodeSVG value={qrValue} size={128} />);
        printWindow.document.write(`
          <div class="cell">
            ${svg}
            <p><strong>${m.materialCode}</strong></p>
            <p>Qty: ${m.initialQuantity}</p>
          </div>
        `);
      } else {
        printWindow.document.write(`<div class="cell"></div>`);
      }
    });

    printWindow.document.write(`
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("batchCreate.title", {})}
      </h2>

      {/* ✅ PDF IMPORT (multi) */}
      <div className="mb-6 p-4 border rounded-md bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          {tr("batchCreate.pdf.title", "Import from PDF")}
        </h3>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleFilesChange}
            className="block w-full text-sm text-gray-700"
          />

          <button
            onClick={handleParsePdf}
            disabled={files.length === 0 || isParsing}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:bg-indigo-400"
          >
            {isParsing
              ? tr("batchCreate.pdf.parsing", "Parsing...")
              : tr("batchCreate.pdf.parseBtn", "Parse PDFs")}
          </button>

          <button
            onClick={clearParsed}
            disabled={files.length === 0 && parsedMaterials.length === 0}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium disabled:bg-gray-100 disabled:text-gray-400"
          >
            {tr("common.clear", "Clear")}
          </button>
        </div>

        {/* Selected files */}
        {files.length > 0 && (
          <div className="mt-3 text-sm text-gray-700">
            {tr("batchCreate.pdf.selected", "Selected PDFs")}:{" "}
            <strong>{files.length}</strong>
            <ul className="list-disc ml-5 mt-1">
              {files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          </div>
        )}

        {parseError && (
          <div className="text-red-600 text-sm mt-3 whitespace-pre-line">{parseError}</div>
        )}

        {/* Per-file parse errors */}
        {parseErrorsByFile.length > 0 && (
          <div className="mt-3 text-sm text-red-600">
            <div className="font-semibold">
              {tr("batchCreate.pdf.someFailed", "Some PDFs had issues:")}
            </div>
            <ul className="list-disc ml-5 mt-1">
              {parseErrorsByFile.map((e, idx) => (
                <li key={`${e.fileName}-${idx}`}>
                  <strong>{e.fileName}:</strong> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsedMaterials.length > 0 && (
          <div className="mt-3 text-sm text-gray-700">
            {tr("batchCreate.pdf.found", "Found")}{" "}
            <strong>{parsedMaterials.length}</strong>{" "}
            {tr("batchCreate.pdf.codes", "material codes")}:
            <div className="mt-2 flex flex-wrap gap-2">
              {parsedMaterials.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center px-2 py-1 rounded bg-white border text-gray-800"
                >
                  {m}
                </span>
              ))}
            </div>
            <p className="mt-3 text-gray-600">
              {tr(
                "batchCreate.pdf.fillQtyHint",
                'Quantities were left empty — fill them below and click "Save All".'
              )}
            </p>
          </div>
        )}
      </div>

      {/* MANUAL / EDITABLE ROWS */}
      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            placeholder={t("batchCreate.materialCodePlaceholder", {}) as any}
            value={e.code}
            onChange={(ev) => handleChange(i, "code", ev.target.value)}
            className="border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="number"
            placeholder={t("batchCreate.quantityPlaceholder", {}) as any}
            value={e.qty}
            onChange={(ev) => handleChange(i, "qty", ev.target.value)}
            className="border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      ))}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleAddRow}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium"
        >
          {t("batchCreate.addRow", {}) as any}
        </button>

        <button
          onClick={handleSaveAll}
          disabled={isSaving || validEntries.length === 0}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:bg-indigo-400"
          title={
            validEntries.length === 0
              ? tr("batchCreate.needValidRow", "Add at least one valid row (code + qty > 0)")
              : ""
          }
        >
          {isSaving ? (t("batchCreate.saving", {}) as any) : (t("batchCreate.saveAll", {}) as any)}
        </button>
      </div>

      {newMaterials.length > 0 && (
        <div className="mt-8 pt-6 border-t">
          <h3 className="text-xl font-semibold text-gray-700 mb-4">
            {(t("batchCreate.generatedLabelsTitle", {}) as any)} ({newMaterials.length})
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-4 bg-gray-50 rounded-md">
            {newMaterials.map((m) => {
              const qrData: QrData = {
                id: m.id,
                materialCode: m.materialCode,
                quantity: m.initialQuantity,
              };
              const qrValue = JSON.stringify(qrData);

              return (
                <div key={m.id} className="text-center p-2 bg-white rounded shadow">
                  <QRCodeSVG value={qrValue} size={120} className="mx-auto" />
                  <p className="font-bold text-gray-800 text-sm mt-2 truncate">{m.materialCode}</p>
                  <p className="text-xs text-gray-500">
                    {(t("common.quantity", {}) as any)}: {m.initialQuantity}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => handlePrintAll(newMaterials, "sticker")}
              className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              {t("batchCreate.printStickerLayout", {}) as any}
            </button>
            <button
              onClick={() => handlePrintAll(newMaterials, "full")}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {t("batchCreate.printFullBleedLayout", {}) as any}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchCreateView;
