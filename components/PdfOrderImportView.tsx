import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { ProductionSheet } from "../src/types";
import type { ParsedPdfMulti } from "../api/client";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, rgb } from "pdf-lib";

const PdfOrderImportView: React.FC = () => {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedPdfMulti | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // used for Create PDF with QR
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParsed(null);
    setError(null);
    const f = e.target.files?.[0] || null;
    setFile(f);
  };

  const handleParse = async () => {
    if (!file) return;
    setIsParsing(true);
    setError(null);
    try {
      const result = await api.parseOrderPdf(file);
      setParsed(result);
    } catch (e: any) {
      console.error(e);
      setError(e.message || t("pdfImport.errors.parseFailed"));
    } finally {
      setIsParsing(false);
    }
  };

  const handleExportXlsx = async () => {
    if (!file) return;
    setIsExportingXlsx(true);
    setError(null);

    try {
      const blob = await api.exportPhasesXlsx(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${parsed?.orderNumber || "order"}_phases.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error(e);
      setError(e.message || t("pdfImport.errors.exportXlsxFailed"));
    } finally {
      setIsExportingXlsx(false);
    }
  };

  const chunkArray = (arr: any[], size: number) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // filter out material tickets by itemCode prefix 010–018
  const shouldIgnoreMaterialTicket = (tt: any) => {
    const code = String(tt?.itemCode ?? "").trim();
    return /^(010|011|012|013|014|015|016|017|018)/.test(code);
  };

  const printMaterialTickets = (ticketsToPrint: any[], mode: string) => {
    if (!ticketsToPrint || ticketsToPrint.length === 0) return;

    const filtered = ticketsToPrint.filter((tt) => !shouldIgnoreMaterialTicket(tt));
    if (filtered.length === 0) return;

    const printWindow = window.open("", "_blank", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    const pages = chunkArray(filtered, 24);

    printWindow.document.write(`
      <html><head><title>${t("pdfImport.printWindows.printMaterialTicketsTitle")}</title>
      <style>
        @page { size: A4 portrait; margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; } }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white;
          font-family: Arial, sans-serif;
        }
        .page {
          display: grid;
          grid-template-columns: repeat(3, 70mm);
          grid-template-rows: repeat(8, ${cellHeight}mm);
          width: 210mm;
          height: 297mm;
          padding: ${verticalPadding}mm 0;
          box-sizing: border-box;

          break-after: page;
          page-break-after: always;
        }
        .page:last-child {
          break-after: auto;
          page-break-after: auto;
        }

        .cell {
          width: 70mm;
          height: ${cellHeight}mm;
          display: flex;
          flex-direction: column;
          justify-content: center;
          box-sizing: border-box;
          padding: 3mm;
          overflow: hidden;
        }
        .row {
          font-size: 10px;
          line-height: 1.15;
          font-weight: 700;
          margin: 0;
          padding: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .desc {
          font-size: 10px;
          line-height: 1.15;
          font-weight: 700;
          margin: 0;
          padding: 0;
          white-space: normal;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      </style></head><body>
    `);

    pages.forEach((pageTickets) => {
      printWindow.document.write(`<div class="page">`);

      pageTickets.forEach((tt: any) => {
        printWindow.document.write(`
          <div class="cell">
            <p class="row">ΕΝΤΟΛΗ : ${tt.productionSheetNumber}</p>
            <p class="row">ΓΙΑ ΠΡΟΙΟΝ : ${tt.productId}</p>
            <p class="row">ΑΡ.ΕΙΔΟΥΣ : ${tt.itemCode}</p>
            <p class="desc">${tt.description}</p>
            <p class="row">ΠΟΣΟΤ.ΕΝΤΟΛΗΣ: ${tt.qtyText} ${tt.unit}</p>
          </div>
        `);
      });

      printWindow.document.write(`</div>`);
    });

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  // ---------------------------
  // Create PDF with QR logic
  // ---------------------------

  const normSheetNo = (v: any) => String(v ?? "").trim().replace(/^0+/, "");

  const makeQrSvg = (value: string) => {
    let svg = renderToStaticMarkup(
      <QRCodeSVG value={value} size={128} level="M" marginSize={0} />
    );

    // critical for Image decoding
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return svg;
  };

  const getOrCreateSheetsForOrder = async (): Promise<ProductionSheet[]> => {
    if (!parsed) return [];

    const existingSheets = await api.getSheetsByOrderId(parsed.orderNumber);
    if (existingSheets && existingSheets.length > 0) {
      return existingSheets.map((s: any) => ({
        id: s.id,
        orderNumber: s.orderNumber || parsed.orderNumber,
        productId: s.productId,
        productionSheetNumber: s.productionSheetNumber,
        quantity: s.quantity,
        qrValue: s.qrValue,
      }));
    }

    const sheetsToCreate = parsed.sheets.map((s) => {
      const phasesWithPosition = (s.productDef?.phases || []).map((phase: any) => ({
        ...phase,
        position: phase.position,
      }));

      return {
        productionSheetNumber: s.sheetNumber,
        productId: s.productDef.id,
        quantity: s.quantity,
        orderNumber: parsed.orderNumber,
        productDef: {
          ...s.productDef,
          phases: phasesWithPosition,
        },
      };
    });

    const newSheets = await api.createOrderAndSheets(parsed.orderNumber, sheetsToCreate);

    return newSheets.map((s: any) => ({
      id: s.id,
      orderNumber: parsed.orderNumber,
      productId: s.productId,
      productionSheetNumber: s.productionSheetNumber,
      quantity: s.quantity,
      qrValue: s.qrValue,
    }));
  };

  const svgToPngBytes = async (svg: string, sizePx: number) => {
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error("Failed to decode SVG into Image (check xmlns)."));
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

  const buildIncludeIndices = () => {
    if (!parsed?.pdfPages?.length) return [];

    const normPhase = (v: any) => String(v ?? "").trim();
    const lastPhaseBySheet = new Map<string, string>();

    for (const s of parsed.sheets) {
      const phases = [...(s.productDef?.phases || [])];
      phases.sort((a: any, b: any) => Number(a.position) - Number(b.position));
      const last = phases[phases.length - 1];

      const sheetKey = normSheetNo(s.sheetNumber);
      const lastPhaseId = normPhase(last?.phaseId);
      if (sheetKey && lastPhaseId) lastPhaseBySheet.set(sheetKey, lastPhaseId);
    }

    const pages: any[] = parsed.pdfPages as any[];
    const include = new Set<number>();
    let i = 0;

    while (i < pages.length) {
      const p: any = pages[i];

      if (p.type === "ORDER_CARD") {
        const groupStart = i;
        let groupEnd = i;

        while (groupEnd < pages.length && pages[groupEnd].type === "ORDER_CARD") {
          const cur = pages[groupEnd];
          include.add(cur.pageNumber - 1);

          if (cur.isEndOfList) break;
          if (pages[groupEnd + 1]?.type === "STORAGE") break;
          groupEnd++;
        }

        let sheetNo: string | null = null;
        for (let k = groupStart; k <= groupEnd && k < pages.length; k++) {
          if (pages[k].productionSheetNumber) {
            sheetNo = normSheetNo(pages[k].productionSheetNumber);
            break;
          }
        }

        const nextIdx = groupEnd + 1;
        if (nextIdx < pages.length) {
          const nextPage = pages[nextIdx];
          if (nextPage.type === "STORAGE" && sheetNo) {
            const lastPhaseId = normPhase(lastPhaseBySheet.get(sheetNo));
            if (lastPhaseId === "20") include.add(nextPage.pageNumber - 1);
          }
        }

        i = groupEnd + 1;
        continue;
      }

      i++;
    }

    return Array.from(include).sort((a, b) => a - b);
  };

  // ✅ now DOWNLOADS the generated PDF (like XLSX), instead of opening/printing
  const stampQrsAndDownload = async (sheets: ProductionSheet[]) => {
    if (!file || !parsed?.pdfPages?.length) return;

    const qrBySheet = new Map<string, string>();
    for (const s of sheets || []) {
      const key = normSheetNo(s.productionSheetNumber);
      if (key && (s as any).qrValue) qrBySheet.set(key, (s as any).qrValue);
    }

    const indices = buildIncludeIndices();
    if (indices.length === 0) return;

    const srcBytes = await file.arrayBuffer();
    const srcPdf = await PDFDocument.load(srcBytes);
    const outPdf = await PDFDocument.create();

    const copied = await outPdf.copyPages(srcPdf, indices);
    copied.forEach((pg) => outPdf.addPage(pg));

    const pngCache = new Map<string, any>();
    const PNG_SIZE = 512;

    for (let outIdx = 0; outIdx < indices.length; outIdx++) {
      const originalZeroBased = indices[outIdx];
      const meta: any = (parsed.pdfPages as any[])[originalZeroBased];
      if (!meta || meta.type !== "ORDER_CARD") continue;

      const sheetNo = normSheetNo(meta.productionSheetNumber);
      if (!sheetNo) continue;

      const qrValue = qrBySheet.get(sheetNo);
      if (!qrValue) continue;

      let embeddedPng = pngCache.get(sheetNo);
      if (!embeddedPng) {
        const svg = makeQrSvg(qrValue);
        const pngBytes = await svgToPngBytes(svg, PNG_SIZE);
        embeddedPng = await outPdf.embedPng(pngBytes);
        pngCache.set(sheetNo, embeddedPng);
      }

      const page = outPdf.getPage(outIdx);
      const { width, height } = page.getSize();

      const size = 70;
      const margin = 18;
      const x = width - size - margin;
      const y = height - size - margin;

      page.drawRectangle({
        x: x - 2,
        y: y - 2,
        width: size + 4,
        height: size + 4,
        color: rgb(1, 1, 1),
        opacity: 0.95,
        borderWidth: 0,
      });

      page.drawImage(embeddedPng, { x, y, width: size, height: size });
    }

    const outBytes = await outPdf.save();
    const ab = Uint8Array.from(outBytes).buffer;
    const blob = new Blob([ab], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${parsed?.orderNumber || "order"}_with_qr.pdf`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };











  const handleCreatePdfWithQrWithoutRemovingExtraPages = async () => {
    if (!parsed || !file) return;

    setIsSaving(true);
    setError(null);

    try {
      const sheets = await getOrCreateSheetsForOrder();
      if (!sheets || sheets.length === 0) {
        setError(t("pdfImport.errors.noSheetsForOrder"));
        return;
      }

      // Build the PDF but skip the filtering for extra pages
      const qrBySheet = new Map<string, string>();
      for (const s of sheets || []) {
        const key = normSheetNo(s.productionSheetNumber);
        if (key && (s as any).qrValue) qrBySheet.set(key, (s as any).qrValue);
      }

      const srcBytes = await file.arrayBuffer();
      const srcPdf = await PDFDocument.load(srcBytes);
      const outPdf = await PDFDocument.create();

      const copied = await outPdf.copyPages(srcPdf, [...Array(srcPdf.getPageCount()).keys()]);
      copied.forEach((pg) => outPdf.addPage(pg));

      const pngCache = new Map<string, any>();
      const PNG_SIZE = 512;

      for (let outIdx = 0; outIdx < copied.length; outIdx++) {
        const page = outPdf.getPage(outIdx);
        const meta: any = (parsed.pdfPages as any[])[outIdx];
        if (!meta || meta.type !== "ORDER_CARD") continue;

        const sheetNo = normSheetNo(meta.productionSheetNumber);
        if (!sheetNo) continue;

        const qrValue = qrBySheet.get(sheetNo);
        if (!qrValue) continue;

        let embeddedPng = pngCache.get(sheetNo);
        if (!embeddedPng) {
          const svg = makeQrSvg(qrValue);
          const pngBytes = await svgToPngBytes(svg, PNG_SIZE);
          embeddedPng = await outPdf.embedPng(pngBytes);
          pngCache.set(sheetNo, embeddedPng);
        }

        const { width, height } = page.getSize();
        const size = 70;
        const margin = 18;
        const x = width - size - margin;
        const y = height - size - margin;

        page.drawRectangle({
          x: x - 2,
          y: y - 2,
          width: size + 4,
          height: size + 4,
          color: rgb(1, 1, 1),
          opacity: 0.95,
          borderWidth: 0,
        });

        page.drawImage(embeddedPng, { x, y, width: size, height: size });
      }

      const outBytes = await outPdf.save();
      const ab = Uint8Array.from(outBytes).buffer;
      const blob = new Blob([ab], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${parsed?.orderNumber || "order"}_with_qr_no_extra_pages.pdf`;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setIsSaving(false);
    }
  };












  const handleCreatePdfWithQr = async () => {
    if (!parsed || !file) return;

    setIsSaving(true);
    setError(null);

    try {
      const sheets = await getOrCreateSheetsForOrder();
      if (!sheets || sheets.length === 0) {
        setError(t("pdfImport.errors.noSheetsForOrder"));
        return;
      }
      await stampQrsAndDownload(sheets); // ✅ download
    } catch (e: any) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setIsSaving(false);
    }
  };

  const filteredMaterialTickets = (parsed?.materialTickets || []).filter(
    (tt: any) => !shouldIgnoreMaterialTicket(tt)
  );

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("pdfImport.title")}
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("pdfImport.fileLabel")}
          </label>

          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700"
          />
        </div>

        {/* Top actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleParse}
            disabled={!file || isParsing || isExportingXlsx || isSaving}
            className="btn-primary"
          >
            {isParsing ? t("pdfImport.buttons.parsing") : t("pdfImport.buttons.parsePdf")}
          </button>

          <button
            onClick={handleExportXlsx}
            disabled={!file || isParsing || isExportingXlsx || isSaving}
            className="btn-export"
            title={t("pdfImport.buttons.exportPhasesXlsx")}
          >
            {isExportingXlsx
              ? t("pdfImport.buttons.exportingXlsx")
              : t("pdfImport.buttons.exportPhasesXlsx")}
          </button>
        </div>

        {error && (
          <div className="text-red-600 text-sm mt-2 whitespace-pre-line">
            {error}
          </div>
        )}

        {parsed && (
          <div className="space-y-3">
            {/* Only action after parse */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleCreatePdfWithQr}
                disabled={
                  !file ||
                  !parsed?.pdfPages?.length ||
                  isSaving ||
                  isParsing ||
                  isExportingXlsx
                }
                className="btn-primary"
              >
                {isSaving ? t("pdfImport.buttons.working") : t("pdfImport.buttons.createPdfWithQr")}
              </button>
            </div>


            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleCreatePdfWithQrWithoutRemovingExtraPages}
                disabled={isSaving || isParsing || isExportingXlsx || !parsed?.pdfPages?.length || !file}
                className="btn-primary"
              >
                {isSaving ? t("pdfImport.buttons.working") : t("pdfImport.buttons.createPdfWithQrWithoutRemovingExtraPages")}
              </button>
            </div>





            {/* Minimal parsed block */}
            <div className="border rounded-md p-4 bg-gray-50 text-sm">
              <h3 className="font-semibold mb-2">{t("pdfImport.parsed.title")}</h3>
              <p>
                <strong>{t("pdfImport.parsed.orderNumber")}:</strong> {parsed.orderNumber}
              </p>

              {/* Material tickets (labels) */}
              {filteredMaterialTickets.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-1">
                    {t("pdfImport.materialTickets.title")}:
                  </h4>

                  <p className="text-gray-700 mb-3">
                    {t("pdfImport.materialTickets.found", {
                      count: filteredMaterialTickets.length,
                    })}
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => printMaterialTickets(filteredMaterialTickets, "sticker")}
                      className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm
                                text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                    >
                      {t("pdfImport.buttons.printMaterialTicketsSticker")}
                    </button>

                    <button
                      onClick={() => printMaterialTickets(filteredMaterialTickets, "full")}
                      className="w-full sm:w-auto flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm
                                text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      {t("pdfImport.buttons.printMaterialTicketsFull")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .btn-primary {
          padding: 0.5rem 1rem;
          background-color: #4F46E5;
          color: white;
          border-radius: 0.375rem;
          font-weight: 500;
        }
        .btn-primary:hover {
          background-color: #4338CA;
        }
        .btn-primary:disabled {
          background-color: #A5B4FC;
          cursor: not-allowed;
        }

        .btn-export {
          padding: 0.5rem 1rem;
          background-color: #16A34A;
          color: white;
          border-radius: 0.375rem;
          font-weight: 600;
        }
        .btn-export:hover {
          background-color: #15803D;
        }
        .btn-export:disabled {
          background-color: #86EFAC;
          cursor: not-allowed;
          color: #14532D;
        }
      `}</style>
    </div>
  );
};

export default PdfOrderImportView;
