import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import * as api from "../api/client";
import { useTranslation } from "../hooks/useTranslation";
import type { Frame, Product, FramePosition, FrameQuality } from "../src/types";

const positions: FramePosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const qualities: FrameQuality[] = [90, 120];

type FrameQrPayload = { type: "FRAME"; frameId: number };

function safeParseFrameQr(text: string): FrameQrPayload | null {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.type === "FRAME" && Number.isFinite(Number(obj.frameId))) {
      return { type: "FRAME", frameId: Number(obj.frameId) };
    }
    return null;
  } catch {
    return null;
  }
}

const FramesView: React.FC = () => {
  const { t } = useTranslation();

  const [frames, setFrames] = useState<Frame[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // ===== Scan =====
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedFrameId, setScannedFrameId] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  // ===== Create / Print many =====
  const [batchFrameIdsText, setBatchFrameIdsText] = useState<string>("");
  const [creatingBatch, setCreatingBatch] = useState(false);

  // ===== Filters =====
  const [filterProductId, setFilterProductId] = useState<string>("");
  const [minWidth, setMinWidth] = useState<string>("");
  const [minHeight, setMinHeight] = useState<string>("");
  const [filterQuality, setFilterQuality] = useState<string>("");

  // Saving state per frame
  const [savingByFrameId, setSavingByFrameId] = useState<Record<number, boolean>>({});

  // Keep latest products in a ref so async handlers don't use stale state
  const productsRef = useRef<Product[]>([]);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [fs, ps] = await Promise.all([api.getFrames(), api.getProducts()]);
        setFrames(fs.sort((a, b) => a.frameId - b.frameId));
        setProducts(ps);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const framesById = useMemo(() => {
    const m = new Map<number, Frame>();
    for (const f of frames) m.set(f.frameId, f);
    return m;
  }, [frames]);

  const setSaving = (frameId: number, v: boolean) => setSavingByFrameId((prev) => ({ ...prev, [frameId]: v }));

  const update = async (frame: Frame, patch: Partial<Frame>) => {
    setSaving(frame.frameId, true);
    try {
      const updated = await api.updateFrame(frame.frameId, {
        position: patch.position ?? frame.position,
        quality: patch.quality ?? frame.quality,
        widthCm: patch.widthCm ?? frame.widthCm,
        heightCm: patch.heightCm ?? frame.heightCm,
        productIds: patch.productIds ?? frame.productIds,
      });

      setFrames((prev) => prev.map((f) => (f.frameId === frame.frameId ? updated : f)));
    } finally {
      setSaving(frame.frameId, false);
    }
  };

  /**
   * Ensure all product codes exist in Products table.
   * If a code is missing, create it via saveProduct().
   * Then refresh products list (so names/etc are consistent).
   */
  const ensureProductsExist = async (ids: string[]) => {
    const trimmed = ids.map((x) => x.trim()).filter(Boolean);
    if (trimmed.length === 0) return;

    const current = productsRef.current || [];
    const existing = new Set(current.map((p) => p.id));

    const missing = Array.from(new Set(trimmed.filter((id) => !existing.has(id))));
    if (missing.length === 0) return;

    // Try create missing products
    await Promise.all(
      missing.map(async (id) => {
        try {
          // Minimal payload; your saveProduct() will ensure name exists
          await api.saveProduct({ id, name: id } as Product);
        } catch {
          // If it already exists (race/duplicate) or backend rejects, ignore and continue.
          // We'll refresh products afterward anyway.
        }
      })
    );

    // Refresh products once (avoid chasing partial local state)
    try {
      const ps = await api.getProducts();
      setProducts(ps);
    } catch {
      // If refresh fails, at least we attempted creation.
    }
  };

  // ===== PRINT =====
  const printFrames = (toPrint: Frame[], mode: "sticker" | "full") => {
    const totalCells = 24;
    const filled: (Frame | null)[] = [...toPrint];
    while (filled.length < totalCells) filled.push(null);

    const printWindow = window.open("", "", "height=1000,width=800");
    if (!printWindow) return;

    const cellHeight = mode === "full" ? 37.125 : 33.9;
    const verticalPadding = mode === "full" ? 0 : 12.9;

    const printTitle = t("frames.print.title") || "Print Frame QR Labels";
    const chromeWarn =
      t("frames.print.chromeWarning") ||
      'IMPORTANT: For perfect alignment in Chrome, disable "Headers and footers" in the print settings dialog.';

    printWindow.document.write(`
      <html>
        <head>
          <title>${printTitle}</title>
          <meta name="description" content="Frame QR Sticker Sheet">
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
            .cell p { margin: 1px 0; font-size: 10px; line-height: 1.1; }
          </style>

          <script>
            (function() {
              const isChrome = navigator.userAgent.toLowerCase().includes('chrome');
              const warned = localStorage.getItem('qrprint_warned');
              if (isChrome && !warned) {
                alert(${JSON.stringify(chromeWarn)});
                localStorage.setItem('qrprint_warned', '1');
              }
            })();
          </script>
        </head>
        <body>
          <div class="page">
    `);

    filled.forEach((f) => {
      if (!f) {
        printWindow.document.write(`<div class="cell"></div>`);
        return;
      }

      const qrValue = JSON.stringify({ type: "FRAME", frameId: f.frameId });
      const svg = renderToStaticMarkup(<QRCodeSVG value={qrValue} size={128} />);

      printWindow.document.write(`
        <div class="cell">
          ${svg}
          <p><strong>FRAME ${f.frameId}</strong></p>
        </div>
      `);
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

  // ===== Helpers for batch parsing =====
  const parseFrameIds = (text: string): number[] => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const parts = cleaned.split(/[,\s]+/).filter(Boolean);

    const ids: number[] = [];
    for (const part of parts) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let i = start; i <= end; i++) ids.push(i);
      } else {
        const n = Number(part);
        if (Number.isFinite(n)) ids.push(n);
      }
    }

    const uniq = Array.from(new Set(ids.filter((n) => n > 0)));
    uniq.sort((a, b) => a - b);
    return uniq;
  };

  const refreshFrames = async () => {
    const fs = await api.getFrames();
    setFrames(fs.sort((a, b) => a.frameId - b.frameId));
  };

  const createAndMaybePrintBatch = async (modeToPrint?: "sticker" | "full") => {
    const ids = parseFrameIds(batchFrameIdsText);
    if (ids.length === 0) return alert(t("frames.alert.enterFrameIds") || "Enter one or more FrameIds (e.g. 1,2,3-6).");

    setCreatingBatch(true);
    try {
      const existing = new Set(frames.map((f) => f.frameId));

      for (const id of ids) {
        if (!existing.has(id)) {
          await api.createFrame(id);
          existing.add(id);
        }
      }

      await refreshFrames();

      if (modeToPrint) {
        const fs = await api.getFrames();
        const byId = new Map<number, Frame>();
        fs.forEach((f) => byId.set(f.frameId, f));
        const toPrintFresh = ids.map((id) => byId.get(id)).filter((x): x is Frame => !!x);
        printFrames(toPrintFresh, modeToPrint);
      }

      setBatchFrameIdsText("");
    } finally {
      setCreatingBatch(false);
    }
  };

  // ===== Frame Scan (camera) =====
  const stopScan = async () => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (scanStreamRef.current) {
      for (const track of scanStreamRef.current.getTracks()) track.stop();
      scanStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanOpen(false);
  };

  const startScan = async () => {
    setScanError(null);
    setScannedFrameId(null);
    setScanOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      scanStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const hasBarcodeDetector = typeof (window as any).BarcodeDetector !== "undefined";
      if (hasBarcodeDetector) {
        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

        scanTimerRef.current = window.setInterval(async () => {
          try {
            const video = videoRef.current;
            if (!video) return;

            const barcodes = await detector.detect(video);
            if (!barcodes || barcodes.length === 0) return;

            const raw = barcodes[0]?.rawValue || "";
            const parsed = safeParseFrameQr(raw);
            if (parsed) {
              setScannedFrameId(parsed.frameId);
              await stopScan();

              setTimeout(() => {
                const el = document.getElementById(`frame-card-${parsed.frameId}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 200);
            }
          } catch {
            // ignore detection errors
          }
        }, 250);
      } else {
        setScanError(
          t("frames.scan.notSupported") ||
            "QR scanning is not supported in this browser. Use Chrome (Android) or a device/browser that supports BarcodeDetector."
        );
      }
    } catch (e: any) {
      setScanError((e?.message as string) || (t("frames.scan.permissionDenied") || "Camera permission denied or not available."));
      setScanOpen(false);
    }
  };

  // ===== Products input parsing (manual typing) =====
  const normalizeProductCodes = (text: string) => {
    const parts = text
      .split(/[\s,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  };

  // ===== Filtering =====
  const filteredFrames = useMemo(() => {
    const prod = filterProductId.trim();
    const w = minWidth.trim() === "" ? null : Number(minWidth);
    const h = minHeight.trim() === "" ? null : Number(minHeight);
    const q = filterQuality.trim() === "" ? null : Number(filterQuality);

    const hasW = w !== null && Number.isFinite(w) && w > 0;
    const hasH = h !== null && Number.isFinite(h) && h > 0;
    const hasQ = q !== null && Number.isFinite(q);

    if (!prod && !hasW && !hasH && !hasQ) return frames;

    return frames.filter((f) => {
      // product filter
      if (prod) {
        const ids = f.productIds || [];
        if (!ids.includes(prod)) return false;
      }

      // quality filter (null = not matching)
      if (hasQ) {
        if (f.quality === null || Number(f.quality) !== (q as number)) return false;
      }

      // dimension filters (null = not matching)
      if (hasW) {
        if (f.widthCm === null || f.widthCm < (w as number)) return false;
      }
      if (hasH) {
        if (f.heightCm === null || f.heightCm < (h as number)) return false;
      }

      return true;
    });
  }, [frames, filterProductId, minWidth, minHeight, filterQuality]);

  const clearFilters = () => {
    setFilterProductId("");
    setMinWidth("");
    setMinHeight("");
    setFilterQuality("");
  };

  if (loading) return <div className="p-6 bg-white rounded-lg shadow">{t("frames.loading") || "Loading frames..."}</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">{t("frames.title") || "Frames"}</h2>

      {/* ===== Frame Scan ===== */}
      <div className="p-4 border rounded-md bg-gray-50 mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <button onClick={startScan} className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-900 font-medium">
              {t("frames.scan.button") || "Frame Scan"}
            </button>

            {scannedFrameId !== null && (
              <div className="text-sm text-gray-700">
                {(t("frames.scan.scanned") || "Scanned")}: <strong>FRAME {scannedFrameId}</strong>
              </div>
            )}
          </div>

          {scanOpen && (
            <div className="border rounded-md bg-white p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-800">{t("frames.scan.title") || "Scan QR"}</div>
                <button
                  onClick={stopScan}
                  className="px-3 py-1 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm"
                >
                  {t("common.close") || "Close"}
                </button>
              </div>

              {scanError && <div className="text-sm text-red-600 mb-2">{scanError}</div>}

              <video ref={videoRef} className="w-full max-w-md rounded-md border bg-black" playsInline muted />

              <div className="text-xs text-gray-600 mt-2">
                {t("frames.scan.help") || "Point the camera at the frame QR. It will auto-open that frame editor."}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== Filters ===== */}
      <div className="p-4 border rounded-md bg-gray-50 mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-800">{t("frames.filters.title") || "Filter Frames"}</div>
            <div className="text-xs text-gray-600">
              {(t("frames.filters.showing") || "Showing")} <strong>{filteredFrames.length}</strong> / {frames.length}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-600">{t("frames.filters.productId") || "ProductId"}</label>
              <input
                type="text"
                value={filterProductId}
                onChange={(e) => setFilterProductId(e.target.value)}
                placeholder={t("frames.filters.productIdPlaceholder") || "Type productId (e.g. PRD001)"}
                className="w-full border border-gray-300 rounded-md p-2"
              />
              <div className="text-[11px] text-gray-500 mt-1">
                {t("frames.filters.productHelp") || "Shows frames that include this productId in “Products included”."}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-600">{t("frames.filters.quality") || "Quality"}</label>
              <select
                value={filterQuality}
                onChange={(e) => setFilterQuality(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-2"
              >
                <option value="">{t("common.dash") || "—"}</option>
                {qualities.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">{t("frames.filters.minWidth") || "Min width (cm)"}</label>
              <input
                type="number"
                value={minWidth}
                onChange={(e) => setMinWidth(e.target.value)}
                placeholder={t("frames.filters.minWidthPlaceholder") || "e.g. 30"}
                className="w-full border border-gray-300 rounded-md p-2"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">{t("frames.filters.minHeight") || "Min height (cm)"}</label>
              <input
                type="number"
                value={minHeight}
                onChange={(e) => setMinHeight(e.target.value)}
                placeholder={t("frames.filters.minHeightPlaceholder") || "e.g. 40"}
                className="w-full border border-gray-300 rounded-md p-2"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={clearFilters}
              className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm"
            >
              {t("frames.filters.clear") || "Clear filters"}
            </button>

            {scannedFrameId !== null && (
              <button
                onClick={() => {
                  clearFilters();
                  setTimeout(() => {
                    const el = document.getElementById(`frame-card-${scannedFrameId}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 50);
                }}
                className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm"
              >
                {t("frames.filters.clearAndJump") || "Clear + jump to scanned"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== List (filtered) ===== */}
      <div className="grid grid-cols-1 gap-4">
        {filteredFrames.map((f) => {
          const isSaving = !!savingByFrameId[f.frameId];

          const productText = (f.productIds || []).join(", ");
          const hasUnknown = (f.productIds || []).some((id) => !productsById.has(id));

          return (
            <div
              key={f.frameId}
              id={`frame-card-${f.frameId}`}
              className={`border rounded-lg p-4 ${scannedFrameId === f.frameId ? "ring-2 ring-indigo-500" : ""}`}
            >
              <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-white p-2 rounded shadow">
                    <QRCodeSVG value={JSON.stringify({ type: "FRAME", frameId: f.frameId })} size={90} />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-800">
                      {t("frames.frame") || "FRAME"} {f.frameId}
                    </div>
                    <div className="text-sm text-gray-600">
                      {(t("frames.fields.position") || "Position")}: {f.position ?? "—"} ·{" "}
                      {(t("frames.fields.quality") || "Quality")}: {f.quality ?? "—"} ·{" "}
                      {(t("frames.fields.size") || "Size")}: {f.widthCm && f.heightCm ? `${f.widthCm}×${f.heightCm} cm` : "—"}
                    </div>
                    {hasUnknown && (
                      <div className="text-xs text-amber-700 mt-1">
                        {t("frames.products.unknownWarning") ||
                          "Some product codes are unknown (not found in Products list) — saved anyway."}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* Position */}
                <div>
                  <label className="text-xs text-gray-600">{t("frames.fields.positionLabel") || "Position (1-17)"}</label>
                  <select
                    value={f.position ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : (Number(e.target.value) as FramePosition);
                      update(f, { position: v });
                    }}
                    className="w-full border border-gray-300 rounded-md p-2"
                    disabled={isSaving}
                  >
                    <option value="">{t("common.dash") || "—"}</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quality */}
                <div>
                  <label className="text-xs text-gray-600">{t("frames.fields.qualityLabel") || "Quality"}</label>
                  <select
                    value={f.quality ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : (Number(e.target.value) as FrameQuality);
                      update(f, { quality: v });
                    }}
                    className="w-full border border-gray-300 rounded-md p-2"
                    disabled={isSaving}
                  >
                    <option value="">{t("common.dash") || "—"}</option>
                    {qualities.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Width (NOT locked anymore) */}
                <div>
                  <label className="text-xs text-gray-600">{t("frames.fields.widthLabel") || "Width (cm)"}</label>
                  <input
                    type="number"
                    value={f.widthCm ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setFrames((prev) => prev.map((x) => (x.frameId === f.frameId ? { ...x, widthCm: v } : x)));
                    }}
                    onBlur={() => {
                      const curr = framesById.get(f.frameId);
                      if (!curr) return;
                      update(curr, { widthCm: curr.widthCm });
                    }}
                    className="w-full border border-gray-300 rounded-md p-2"
                    disabled={isSaving}
                  />
                </div>

                {/* Height (NOT locked anymore) */}
                <div>
                  <label className="text-xs text-gray-600">{t("frames.fields.heightLabel") || "Height (cm)"}</label>
                  <input
                    type="number"
                    value={f.heightCm ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setFrames((prev) => prev.map((x) => (x.frameId === f.frameId ? { ...x, heightCm: v } : x)));
                    }}
                    onBlur={() => {
                      const curr = framesById.get(f.frameId);
                      if (!curr) return;
                      update(curr, { heightCm: curr.heightCm });
                    }}
                    className="w-full border border-gray-300 rounded-md p-2"
                    disabled={isSaving}
                  />
                </div>

                {/* Products (manual) */}
                <div>
                  <label className="text-xs text-gray-600">{t("frames.products.inputLabel") || "Products included (type codes)"}</label>
                  <input
                    type="text"
                    defaultValue={productText}
                    placeholder={t("frames.products.placeholder") || "e.g. PRD001, PRD002 PRD003"}
                    onBlur={(e) => {
                      void (async () => {
                        const list = normalizeProductCodes(e.currentTarget.value);

                        // 1) Ensure products exist in DB (create missing)
                        await ensureProductsExist(list);

                        // 2) Save frame with productIds
                        await update(f, { productIds: list });

                        // 3) Normalize input display
                        e.currentTarget.value = list.join(", ");
                      })();
                    }}
                    className="w-full border border-gray-300 rounded-md p-2"
                    disabled={isSaving}
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {(t("frames.products.saved") || "Saved")}:{" "}
                    {(f.productIds || []).length === 0
                      ? t("common.dash") || "—"
                      : (f.productIds || []).map((id) => productsById.get(id)?.name || id).join(", ")}
                  </div>
                </div>
              </div>

              {isSaving && <div className="text-sm text-gray-500 mt-3">{t("common.saving") || "Saving..."}</div>}
            </div>
          );
        })}

        {filteredFrames.length === 0 && (
          <div className="p-4 border rounded-md bg-gray-50 text-gray-700">{t("frames.filters.noResults") || "No frames match the current filters."}</div>
        )}
      </div>

      {/* ===== Create / Batch Create + Print ===== */}
      <div className="p-4 border rounded-md bg-gray-50 mt-6 mb-6">
        <div className="text-sm font-medium text-gray-800 mb-2">{t("frames.createPrint.title") || "Create / Print Frame Stickers"}</div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <input
              type="text"
              placeholder={t("frames.createPrint.frameIdsPlaceholder") || "FrameIds (e.g. 1,2,3-6 10)"}
              value={batchFrameIdsText}
              onChange={(e) => setBatchFrameIdsText(e.target.value)}
              className="border border-gray-300 rounded-md p-2 w-full sm:w-[360px]"
            />

            <button
              onClick={() => createAndMaybePrintBatch(undefined)}
              disabled={creatingBatch}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:opacity-60"
            >
              {t("frames.createPrint.createOnly") || "Create Frame(s) + QR"}
            </button>

            <button
              onClick={() => createAndMaybePrintBatch("sticker")}
              disabled={creatingBatch}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium disabled:opacity-60"
            >
              {t("frames.createPrint.createAndPrintStickers") || "Create & Print Stickers"}
            </button>

            <button
              onClick={() => createAndMaybePrintBatch("full")}
              disabled={creatingBatch}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium disabled:opacity-60"
            >
              {t("frames.createPrint.createAndPrintFull") || "Create & Print Full Bleed"}
            </button>
          </div>

          <div className="text-xs text-gray-600">
            {t("frames.qr.containsOnly") || "QR contains only"}: <code>{`{"type":"FRAME","frameId":X}`}</code>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center pt-2 border-t">
            <button onClick={() => printFrames(frames, "sticker")} className="px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-800 font-medium">
              {t("frames.createPrint.printAllStickers") || "Print Sticker Layout (all)"}
            </button>

            <button
              onClick={() => printFrames(frames, "full")}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium"
            >
              {t("frames.createPrint.printAllFull") || "Print Full Bleed (all)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FramesView;
