
import React, { useEffect, useRef } from 'react';
// @ts-ignore - html5-qrcode is loaded from CDN
import { Html5QrcodeScanner, Html5QrcodeError, Html5QrcodeResult } from 'html5-qrcode';

interface ScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError: (errorMessage: string) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScanSuccess, onScanError }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      rememberLastUsedCamera: true,
      supportedScanTypes: [0] // SCAN_TYPE_CAMERA
    };

    const handleSuccess = (decodedText: string, decodedResult: Html5QrcodeResult) => {
        if (scannerRef.current) {
            scannerRef.current.clear();
            onScanSuccess(decodedText);
        }
    };

    const handleError = (errorMessage: string, error: Html5QrcodeError) => {
      // we can ignore some errors
      if(errorMessage.toLowerCase().includes("qr code parse error")){
          // this is common when camera is focusing
          return;
      }
      console.warn(`QR Code Scan Error: ${errorMessage}`);
    };

    const scanner = new Html5QrcodeScanner('qr-reader', config, false);
    scanner.render(handleSuccess, handleError);
    scannerRef.current = scanner;

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(error => {
          console.error("Failed to clear html5-qrcode-scanner.", error);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-gray-900 p-4 rounded-lg shadow-inner">
      <div id="qr-reader" className="w-full"></div>
      <p className="text-center text-white mt-2 text-sm">Align QR code within the frame</p>
    </div>
  );
};

export default Scanner;
