
import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Material, QrData } from '../src/types';
import { PrintIcon, CloseIcon } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface QrCodeModalProps {
  material: Material;
  onClose: () => void;
}

const QrCodeModal: React.FC<QrCodeModalProps> = ({ material, onClose }) => {
  const { t } = useTranslation();
  const qrCodeData: QrData = {
    id: material.id,
    materialCode: material.materialCode,
    quantity: material.initialQuantity
  };
  const qrCodeValue = JSON.stringify(qrCodeData);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML;
    if (printContent) {
        const printWindow = window.open('', '', 'height=600,width=800');
        if (printWindow) {
            printWindow.document.write('<html><head><title>Print QR Code</title>');
            printWindow.document.write(`
              <style>
                @media print {
                  body { -webkit-print-color-adjust: exact; }
                }
                body { 
                  font-family: sans-serif; 
                  text-align: center; 
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                } 
                .qr-container { 
                  display: inline-block; 
                  padding: 20px; 
                  border: 1px solid #ccc; 
                  border-radius: 8px;
                }
              </style>
            `);
            printWindow.document.write('</head><body>');
            printWindow.document.write(printContent);
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 250);
        }
    }
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm m-4 relative">
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
            <CloseIcon className="w-6 h-6" />
        </button>
        <div ref={printRef} className="text-center qr-container">
            <h3 className="text-xl font-bold text-gray-800 mb-2">{t('qrModal.title')}</h3>
            <p className="font-semibold text-gray-700">{material.materialCode}</p>
            <p className="text-sm text-gray-500 mb-4">{t('common.quantity')}: {material.initialQuantity}</p>
            <div className="flex justify-center my-4">
                <QRCodeSVG value={qrCodeValue} size={200} />
            </div>
            <p className="text-xs text-gray-400 font-mono break-all">{material.id}</p>
        </div>
        <button
          onClick={handlePrint}
          className="mt-6 w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
        >
          <PrintIcon className="w-5 h-5 mr-2" />
          {t('qrModal.printLabel')}
        </button>
      </div>
    </div>
  );
};

export default QrCodeModal;
