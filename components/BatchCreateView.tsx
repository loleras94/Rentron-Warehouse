import React, { useMemo, useState } from "react";
import { useWarehouse } from "../hooks/useWarehouse";
import { QRCodeSVG } from "qrcode.react";
import type { Material, QrData } from "../src/types";
import { renderToStaticMarkup } from "react-dom/server";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import { PDFDocument, rgb } from "pdf-lib";

type ParsedMaterial = { code: string; sheetCount: number };

/**
 * ✅ FIX:
 * We now support quantities PER blatt (per placement), not “one per page”.
 * Your backend/parser should put the quantity for each blatt here.
 *
 * If the backend still returns only a page-level sheetCount, we’ll fall back to it,
 * but we will ALWAYS prefer pl.sheetCount when present.
 */
type ParsedMaterialsPdfPlacement = { code: string; blattY: number; sheetCount?: number };

type ParsedMaterialsPdfPage = {
  pageNumber: number;
  pageIndex: number;
  codes: string[];
  /** legacy / fallback (old behavior). We keep it for backwards compatibility. */
  sheetCount?: number;
  placements: ParsedMaterialsPdfPlacement[];
};

type ParsedMaterialsPdf = { materials?: ParsedMaterial[]; pages?: ParsedMaterialsPdfPage[] };
type ParsedFile = { file: File; pages: ParsedMaterialsPdfPage[] };

const BatchCreateView: React.FC = () => {
  const { addMaterial, refresh } = useWarehouse();
  const { t } = useTranslation();

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

  const [entries, setEntries] = useState<{ code: string; qty: string }[]>([
    { code: "", qty: "" },
  ]);

  const [files, setFiles] = useState<File[]>([]);
  const [parsedMaterials, setParsedMaterials] = useState<ParsedMaterial[]>([]);
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseErrorsByFile, setParseErrorsByFile] = useState<
    { fileName: string; message: string }[]
  >([]);

  const [newMaterials, setNewMaterials] = useState<Material[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isStamping, setIsStamping] = useState(false);

  const handleAddRow = () =>
    setEntries((prev) => [...prev, { code: "", qty: "" }]);

  const handleChange = (i: number, field: "code" | "qty", value: string) => {
    setEntries((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: value };
      return copy;
    });
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParsedMaterials([]);
    setParsedFiles([]);
    setParseError(null);
    setParseErrorsByFile([]);

    const list = Array.from(e.target.files || []);
    setFiles(list);
  };

  const mergeByCodePreserveOrder = (items: ParsedMaterial[]) => {
    const totals = new Map<string, number>();
    const order: string[] = [];

    for (const it of items) {
      const code = String(it?.code || "").trim();
      if (!code) continue;

      if (!totals.has(code)) {
        totals.set(code, 0);
        order.push(code);
      }
      totals.set(code, (totals.get(code) || 0) + (Number(it.sheetCount) || 0));
    }

    return order.map((code) => ({ code, sheetCount: totals.get(code) || 0 }));
  };

  /**
   * ✅ FIX: derive materials from placements, using per-blatt quantities.
   * We prefer pl.sheetCount (per placement). If missing, fall back to page.sheetCount.
   * This prevents “first blatt qty applied to all materials on that page”.
   */
  const materialsFromPages = (pages: ParsedMaterialsPdfPage[]): ParsedMaterial[] => {
    const items: ParsedMaterial[] = [];

    for (const p of pages || []) {
      const placements = Array.isArray(p.placements) ? p.placements : [];

      for (const pl of placements) {
        const code = String(pl.code || "").trim();
        if (!code) continue;

        const qty =
          (typeof pl.sheetCount === "number" ? pl.sheetCount : undefined) ??
          (typeof p.sheetCount === "number" ? p.sheetCount : undefined) ??
          0;

        items.push({ code, sheetCount: Number(qty) || 0 });
      }
    }

    return items;
  };

  const handleParsePdf = async () => {
    if (files.length === 0) return;

    setIsParsing(true);
    setParseError(null);
    setParseErrorsByFile([]);
    setParsedMaterials([]);
    setParsedFiles([]);

    try {
      const results = await Promise.allSettled(
        files.map((f) => api.parseMaterialsPdf(f))
      );

      const allItems: ParsedMaterial[] = [];
      const perFileErrors: { fileName: string; message: string }[] = [];
      const nextParsedFiles: ParsedFile[] = [];

      results.forEach((r, idx) => {
        const file = files[idx];
        const fileName = file?.name || `PDF ${idx + 1}`;

        if (r.status === "fulfilled") {
          const value = r.value as ParsedMaterialsPdf;

          const pages = Array.isArray((value as any)?.pages)
            ? ((value as any).pages as ParsedMaterialsPdfPage[])
            : [];

          // ✅ IMPORTANT:
          // We intentionally build material quantities from placements
          // so each blatt can have its own sheetCount.
          const matsFromPlacements = materialsFromPages(pages);

          allItems.push(...matsFromPlacements);
          nextParsedFiles.push({ file, pages });

          if (matsFromPlacements.length === 0) {
            perFileErrors.push({
              fileName,
              message: tr(
                "batchCreate.pdf.noMaterialsFound",
                "No materials found in this PDF."
              ),
            });
          } else {
            // Optional: warn if parser isn’t returning per-placement quantities
            const hasAnyPerBlattQty = pages.some((p) =>
              (p.placements || []).some((pl) => typeof pl.sheetCount === "number")
            );
            if (!hasAnyPerBlattQty) {
              perFileErrors.push({
                fileName,
                message: tr(
                  "batchCreate.pdf.noPerBlattQty",
                  "Parsed codes, but no per-blatt quantities were found (using page fallback if available). Update the PDF parser to return sheetCount per blatt."
                ),
              });
            }
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

      const unique = mergeByCodePreserveOrder(allItems);

      if (unique.length === 0) {
        setParseError(
          tr(
            "batchCreate.pdf.noMaterialsInAll",
            "No material codes found in the selected PDFs."
          )
        );
        setParseErrorsByFile(perFileErrors);
        setParsedFiles(nextParsedFiles);
        return;
      }

      setParsedMaterials(unique);
      setParsedFiles(nextParsedFiles);
      setParseErrorsByFile(perFileErrors);

      setEntries((prev) => {
        const cleanedPrev = prev.length === 0 ? [{ code: "", qty: "" }] : prev;

        const existingCodes = new Set(
          cleanedPrev.map((e) => e.code.trim()).filter(Boolean)
        );

        const added = unique
          .filter((m) => !existingCodes.has(m.code))
          .map((m) => ({ code: m.code, qty: String(m.sheetCount || "") }));

        const updated = cleanedPrev.map((row) => {
          const code = row.code.trim();
          if (!code) return row;

          const found = unique.find((m) => m.code === code);
          if (!found) return row;

          if (!row.qty.trim()) return { ...row, qty: String(found.sheetCount || "") };
          return row;
        });

        return [...updated, ...added];
      });
    } catch (e: any) {
      console.error(e);
      setParseError(
        e?.message || tr("batchCreate.pdf.parseFailed", "Failed to parse PDF.")
      );
    } finally {
      setIsParsing(false);
    }
  };

  const clearParsed = () => {
    setFiles([]);
    setParsedMaterials([]);
    setParsedFiles([]);
    setParseError(null);
    setParseErrorsByFile([]);
  };

  const validEntries = useMemo(() => {
    return entries.filter((e) => e.code.trim() && e.qty.trim() && Number(e.qty) > 0);
  }, [entries]);

  // ---------------------------
  // SAVE materials (extracted so we can reuse it)
  // ---------------------------

  const createMaterialsFromEntries = async (): Promise<Material[]> => {
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
    return created;
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setNewMaterials([]);
    try {
      const created = await createMaterialsFromEntries();
      setNewMaterials(created);
      setEntries([{ code: "", qty: "" }]);
    } finally {
      setIsSaving(false);
    }
  };

  // --- PRINT (unchanged) ---
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

  // ---------------------------
  // Stamp QR anchored to Blatt positions
  // ---------------------------

  const makeQrSvg = (value: string) => {
    let svg = renderToStaticMarkup(
      <QRCodeSVG value={value} size={128} level="M" marginSize={0} />
    );
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return svg;
  };

  const svgToPngBytes = async (svg: string, sizePx: number) => {
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to decode SVG into Image (check xmlns)."));
        image.src = svgUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = sizePx;
      canvas.height = sizePx;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context not available");

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, sizePx, sizePx);
      ctx.drawImage(img, 0, 0, sizePx, sizePx);

      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1] || "";
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const stampOnePdfAndDownload = async (
    file: File,
    pages: ParsedMaterialsPdfPage[],
    codeToMaterial: Map<string, Material>
  ) => {
    const srcBytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(srcBytes);

    const pngCache = new Map<string, any>();
    const PNG_SIZE = 512;

    const SIZE = 70;
    const MARGIN_X = 18;

    const QR_BELOW_BLATT = 10;
    const SAME_BLATT_GAP_Y = 8;

    for (const p of pages || []) {
      const page = pdf.getPage(p.pageIndex);
      if (!page) continue;

      const { width } = page.getSize();

      const placements = Array.isArray(p.placements) ? p.placements : [];
      const sorted = [...placements].sort((a, b) => b.blattY - a.blattY);

      const usedAtBlattY = new Map<number, number>();

      for (const pl of sorted) {
        const code = String(pl.code || "").trim();
        if (!code) continue;

        const material = codeToMaterial.get(code);
        if (!material) continue;

        const qrValue = JSON.stringify({
          id: material.id,
          materialCode: material.materialCode,
          quantity: material.initialQuantity,
        });

        let embeddedPng = pngCache.get(material.id);
        if (!embeddedPng) {
          const svg = makeQrSvg(qrValue);
          const pngBytes = await svgToPngBytes(svg, PNG_SIZE);
          embeddedPng = await pdf.embedPng(pngBytes);
          pngCache.set(material.id, embeddedPng);
        }

        const x = width - SIZE - MARGIN_X;

        const key = Math.round(Number(pl.blattY) || 0);
        const stackIndex = usedAtBlattY.get(key) || 0;
        usedAtBlattY.set(key, stackIndex + 1);

        const y =
          (Number(pl.blattY) || 0) -
          QR_BELOW_BLATT -
          SIZE -
          stackIndex * (SIZE + SAME_BLATT_GAP_Y);

        page.drawRectangle({
          x: x - 2,
          y: y - 2,
          width: SIZE + 4,
          height: SIZE + 4,
          color: rgb(1, 1, 1),
          opacity: 0.95,
          borderWidth: 0,
        });

        page.drawImage(embeddedPng, { x, y, width: SIZE, height: SIZE });
      }
    }

    const outBytes = await pdf.save();
    const blob = new Blob([Uint8Array.from(outBytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name.replace(/\.pdf$/i, "")}_with_qr.pdf`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // ---------------------------
  // Combined action: create materials (if needed) + stamp PDFs
  // ---------------------------

  const handleStampUploadedPdfs = async () => {
    if (parsedFiles.length === 0) {
      alert(tr("batchCreate.stamp.noParsedPdfs", "No parsed PDFs available to stamp."));
      return;
    }
    if (validEntries.length === 0 && newMaterials.length === 0) {
      alert(
        tr(
          "batchCreate.stamp.needRowsOrSaved",
          'Add at least one valid row (code + qty > 0) or create materials first.'
        )
      );
      return;
    }

    setIsStamping(true);
    try {
      // 1) Ensure we have materials with IDs
      let materialsToUse: Material[] = newMaterials;

      if (!materialsToUse || materialsToUse.length === 0) {
        setIsSaving(true);
        try {
          const created = await createMaterialsFromEntries();
          materialsToUse = created;
          setNewMaterials(created);

          // keep PDFs; reset rows like Save All
          setEntries([{ code: "", qty: "" }]);
        } finally {
          setIsSaving(false);
        }
      }

      if (!materialsToUse || materialsToUse.length === 0) {
        alert(
          tr(
            "batchCreate.stamp.noMaterialsCreated",
            "No materials were created, so there is nothing to stamp."
          )
        );
        return;
      }

      // 2) Build map code->material
      const codeToMaterial = new Map<string, Material>();
      for (const m of materialsToUse) {
        const code = String((m as any).materialCode || "").trim();
        if (code) codeToMaterial.set(code, m);
      }

      // 3) Stamp each parsed file (downloads each stamped PDF)
      for (const pf of parsedFiles) {
        await stampOnePdfAndDownload(pf.file, pf.pages, codeToMaterial);
      }
    } catch (e: any) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setIsStamping(false);
    }
  };

  const stampBtnDisabled =
    isParsing ||
    isSaving ||
    isStamping ||
    parsedFiles.length === 0 ||
    (newMaterials.length === 0 && validEntries.length === 0);

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("batchCreate.title", {})}
      </h2>

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
                  key={m.code}
                  className="inline-flex items-center px-2 py-1 rounded bg-white border text-gray-800"
                  title={`Sheets: ${m.sheetCount}`}
                >
                  {m.code} <span className="ml-2 text-gray-500">({m.sheetCount})</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-gray-600">
              {tr(
                "batchCreate.pdf.fillQtyHint",
                'Quantities were pre-filled from the PDFs — adjust if needed and click "Save All".'
              )}
            </p>
          </div>
        )}
      </div>

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

        <button
          onClick={handleStampUploadedPdfs}
          disabled={stampBtnDisabled}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium disabled:bg-green-300"
          title={
            parsedFiles.length === 0
              ? tr("batchCreate.stamp.noParsedPdfsTitle", "Parse PDFs first.")
              : newMaterials.length === 0 && validEntries.length === 0
                ? tr(
                    "batchCreate.stamp.needValidRowTitle",
                    "Add at least one valid row (code + qty > 0)."
                  )
                : ""
          }
        >
          {isStamping
            ? tr("batchCreate.stamp.working", "Working...")
            : tr("batchCreate.stamp.btn", "Save + Stamp PDFs with QR")}
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
