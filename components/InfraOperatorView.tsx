import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import * as XLSX from "xlsx";

/* ---------------------------------------------------------
   UNIVERSAL TIMESTAMP PARSER
--------------------------------------------------------- */
function parseTimestamp(ts?: string | null): Date | null {
  if (!ts) return null;
  return new Date(ts);
}

/* ---------------------------------------------------------
   Format local date/time DD-MM-YY HH:mm
--------------------------------------------------------- */
function formatLocalDDMMYYHHmm(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");

  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yy = String(date.getFullYear()).slice(-2);
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

/* ---------------------------------------------------------
   Download helpers (.xlsx)
--------------------------------------------------------- */
function autoFitColumnsFromAoA(data: any[][]) {
  const widths: { wch: number }[] = [];
  data.forEach((row) => {
    row.forEach((cell, colIdx) => {
      const str = cell == null ? "" : String(cell);
      const len = str.length;
      widths[colIdx] = widths[colIdx] || { wch: 10 };
      widths[colIdx].wch = Math.min(60, Math.max(widths[colIdx].wch, len + 2));
    });
  });
  return widths;
}

function downloadXlsxFromAoA(aoa: any[][], fileName: string, sheetName = "Report") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = autoFitColumnsFromAoA(aoa);

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName, { compression: true });
}

/* ---------------------------------------------------------
   COMPONENT
--------------------------------------------------------- */
const InfraOperatorView: React.FC = () => {
  const { t } = useTranslation();
  const [reportDate, setReportDate] = useState(new Date().toISOString().split("T")[0]);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const allLogs = await api.getDailyLogs();

      // Filter logs by date (using startTime)
      const logs = allLogs.filter((log: any) => {
        const start = parseTimestamp(log.startTime);
        if (!start) return false;
        return start.toISOString().split("T")[0] === reportDate;
      });

      if (logs.length === 0) {
        alert(t("infraOperator.noDataForDate", { date: reportDate }));
        return;
      }

      // Headers MUST come from translations (no hardcode)
      const headers = [
        t("infraOperator.excel.headers.type"),
        t("infraOperator.excel.headers.operatorUsername"),
        t("infraOperator.excel.headers.orderNumber"),
        t("infraOperator.excel.headers.productionSheetNumber"),
        t("infraOperator.excel.headers.productId"),
        t("infraOperator.excel.headers.position"),
        t("infraOperator.excel.headers.setupTime"),
        t("infraOperator.excel.headers.productionTime"),
        t("infraOperator.excel.headers.quantityDone"),
        t("infraOperator.excel.headers.deadDescription"),
        t("infraOperator.excel.headers.startTimeLocal"),
        t("infraOperator.excel.headers.endTimeLocal"),
      ];

      const rows: any[][] = [headers];

      logs.forEach((log: any) => {
        const start = parseTimestamp(log.startTime);
        const end = parseTimestamp(log.endTime);

        const operator = log.operatorUsername || log.username || "";

        // FindMaterialTime always comes from PHASE logs (your rule)
        const hasFindMaterialTime =
          log.type !== "dead" && typeof log.findMaterialTime === "number" && log.findMaterialTime > 0;

        // Convert findMaterialTime into a "dead time" row with code 90
        const isConverted90 = hasFindMaterialTime;
        const isDead = log.type === "dead" || isConverted90;

        const deadCodeForType = isConverted90 ? "90" : log.deadCode ?? "";

        const isDeletedPhase =
          log.type !== "dead" &&
          (String(log.stage || "").toLowerCase() === "delete" ||
            String(log.productionPosition ?? log.production_position ?? "").toUpperCase() === "DELETED");

        const typeValue = isDead
          ? `${t("infraOperator.excel.type.deadTime")}: ${deadCodeForType}`
          : isDeletedPhase
            ? `${t("infraOperator.excel.type.phase")}: ${log.phaseId ?? ""} / Deleted`
            : `${t("infraOperator.excel.type.phase")}: ${log.phaseId ?? ""}`;


        // Setup time:
        // - only for phase rows
        // - if it's 0 => EMPTY
        let setupTime: string | number = "";
        if (!isDead && typeof log.setupTime === "number" && log.setupTime > 0) {
          setupTime = (log.setupTime / 60).toFixed(1);
        }

        // Production time:
        // - phase: productionTime/60
        // - dead (and converted 90): duration start/end (minutes)
        let productionTime: string | number = "";
        if (!isDead) {
          if (typeof log.productionTime === "number" && log.productionTime > 0) {
            productionTime = (log.productionTime / 60).toFixed(1);
          }
        } else if (start && end) {
          productionTime = ((end.getTime() - start.getTime()) / 60000).toFixed(1);
        }

        // Quantity done:
        // - never for dead rows
        // - if 0 => empty (your rule)
        let quantityDone: string | number = "";
        if (!isDead) {
          const q = log.quantityDone ?? "";
          quantityDone = q === 0 || q === "0" ? "" : q;
        }

        // Dead description:
        // - dead: log.deadDescription
        // - converted 90: translated "dead time 90 description"
        const deadDescription = isDead
          ? isConverted90
            ? t("infraOperator.excel.dead90Description")
            : log.deadDescription ?? ""
          : "";

        // For converted 90, make it look EXACTLY like a dead time row:
        // - clear order/sheet/product/position/setup/quantity
        const orderNumber = isConverted90 ? "" : (log.orderNumber ?? "");
        const productionSheetNumber = isConverted90 ? "" : (log.productionSheetNumber ?? "");
        const productId = isConverted90 ? "" : (log.productId ?? "");
        const position = isDead ? "" : (log.position ?? "");

        if (isConverted90) {
          setupTime = "";
          quantityDone = "";
        }

        rows.push([
          typeValue,
          operator,
          orderNumber,
          productionSheetNumber,
          productId,
          position,
          setupTime,
          productionTime,
          quantityDone,
          deadDescription,
          formatLocalDDMMYYHHmm(start),
          formatLocalDDMMYYHHmm(end),
        ]);
      });

      downloadXlsxFromAoA(
        rows,
        `daily_report_${reportDate}.xlsx`,
        t("infraOperator.excel.sheetNameDailyReport")
      );
    } catch (err) {
      console.error("Failed to export Excel:", err);
      alert(t("infraOperator.exportError"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMaterialUse = async () => {
    setIsExporting(true);
    try {
      const rows = await api.getDailyMaterialUseLogs(reportDate);

      if (!rows || rows.length === 0) {
        alert(t("infraOperator.noMaterialUseForDate", { date: reportDate }));
        return;
      }

      // Headers for material use sheet via translations (no hardcode)
      const headers = [
        t("infraOperator.materialUseExcel.headers.order"),
        t("infraOperator.materialUseExcel.headers.material"),
        t("infraOperator.materialUseExcel.headers.quantity"),
        t("infraOperator.materialUseExcel.headers.unit"),
      ];

      const data: any[][] = [headers];

      rows.forEach((r: any) => {
        const entoli = r.production_sheet_number
          ? r.production_sheet_number
          : t("infraOperator.materialUseExcel.values.sample");

        const yliko =
          r.source === "remnant"
            ? t("infraOperator.materialUseExcel.values.remnant")
            : (r.material_code || "");
        const posotita = r.source === "remnant" ? "" : (r.quantity ?? "");
        const monada = r.source === "remnant" ? "" : (r.unit ?? "");

        data.push([entoli, yliko, posotita, monada]);
      });

      downloadXlsxFromAoA(
        data,
        `daily_material_use_${reportDate}.xlsx`,
        t("infraOperator.materialUseExcel.sheetName")
      );
    } catch (err) {
      console.error("Failed to export Material Use Excel:", err);
      alert(t("infraOperator.exportError"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("infraOperator.title")}
      </h2>

      <div className="space-y-4">
        <div>
          <label htmlFor="report-date" className="block text-sm font-medium text-gray-700">
            {t("infraOperator.selectDate")}
          </label>

          <input
            id="report-date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md"
          />
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full py-2 rounded-md text-white bg-indigo-600 disabled:bg-indigo-400"
        >
          {isExporting ? t("common.loading") : t("infraOperator.exportExcel")}
        </button>

        <button
          onClick={handleExportMaterialUse}
          disabled={isExporting}
          className="w-full py-2 rounded-md text-white bg-emerald-600 disabled:bg-emerald-400"
        >
          {isExporting ? t("common.loading") : t("infraOperator.exportMaterialUseExcel")}
        </button>
      </div>
    </div>
  );
};

export default InfraOperatorView;
