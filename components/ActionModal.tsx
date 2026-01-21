import React, { useState } from 'react';
import type { ActionType, Material, MaterialLocation } from '../src/types';
import { useWarehouse } from '../hooks/useWarehouse';
import { WAREHOUSE_AREAS, WAREHOUSE_POSITIONS } from '../constants';
import { CloseIcon } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface ActionModalProps {
  actionType: ActionType;
  material: Material;
  onClose: () => void;
  onComplete: () => void;

  initialProductionCode?: string; // ✅ add this
}


const ActionModal: React.FC<ActionModalProps> = ({ actionType, material, onClose, onComplete, initialProductionCode = "" }) => {
    const { updateMaterialConsumption, updateMaterialLocation, updatePartialConsumption } = useWarehouse();
    const { t } = useTranslation();
    
    const [productionCode, setProductionCode] = useState(initialProductionCode);
    const [area, setArea] = useState<string>(String(WAREHOUSE_AREAS[0]));
    const [position, setPosition] = useState<string>(String(WAREHOUSE_POSITIONS[0]));
    const [consumedQuantity, setConsumedQuantity] = useState('');
    const [error, setError] = useState('');
    const [isConfirming, setIsConfirming] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const getTitle = () => {
        return t(`actionModal.titles.${actionType}`);
    };
    
    const executeAction = async () => {
        setIsSubmitting(true);
        setError('');
        const newLocation: MaterialLocation = { area, position };
        try {
            switch (actionType) {
                case 'CONSUMPTION':
                    await updateMaterialConsumption(material.id, productionCode, material.currentQuantity);
                    break;
                case 'PLACEMENT':
                    await updateMaterialLocation(material.id, newLocation, 'PLACED');
                    break;
                case 'MOVEMENT':
                    await updateMaterialLocation(material.id, newLocation, 'MOVED');
                    break;
                case 'PARTIAL_CONSUMPTION':
                    const qty = parseInt(consumedQuantity, 10);
                    await updatePartialConsumption(material.id, qty, productionCode, newLocation);
                    break;
            }
            onComplete();
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
            setIsSubmitting(false); // Stop loading on error so user can see message
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const isDestructive = actionType === 'CONSUMPTION' || actionType === 'PARTIAL_CONSUMPTION';

        if(isDestructive) {
            if (actionType === 'CONSUMPTION' && !productionCode) {
                setError(t('actionModal.productionCodeRequired'));
                return;
            }
            if (actionType === 'PARTIAL_CONSUMPTION') {
                 const qty = parseInt(consumedQuantity, 10);
                 if (isNaN(qty) || qty <= 0 || qty > material.currentQuantity) {
                    setError(t('actionModal.invalidQuantity', { max: material.currentQuantity }));
                    return;
                 }
                 if (!productionCode) {
                    setError(t('actionModal.productionCodeRequired'));
                    return;
                 }
            }
        }
        
        if (isDestructive) {
            setIsConfirming(true);
        } else {
            executeAction();
        }
    };

    const renderFormFields = () => {
        const locationSelector = (
            <>
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('actionModal.newAreaLabel')}</label>
                    <select value={area} onChange={e => setArea(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md disabled:bg-gray-100" disabled={isSubmitting}>
                        {WAREHOUSE_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('actionModal.newPositionLabel')}</label>
                    <select value={position} onChange={e => setPosition(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md disabled:bg-gray-100" disabled={isSubmitting}>
                        {WAREHOUSE_POSITIONS.map((p) => (
                        <option key={String(p)} value={String(p)}>
                            {String(p)}
                        </option>
                        ))}
                    </select>
                </div>
            </>
        );

        const productionCodeInput = (
             <div>
                <label className="block text-sm font-medium text-gray-700">{t('actionModal.productionCodeLabel')}</label>
                <input type="text" value={productionCode} onChange={e => setProductionCode(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100" required disabled={isSubmitting} />
            </div>
        );

        switch (actionType) {
            case 'CONSUMPTION': return productionCodeInput;
            case 'PLACEMENT':
            case 'MOVEMENT': return locationSelector;
            case 'PARTIAL_CONSUMPTION':
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">{t('actionModal.sheetsConsumedLabel', { max: material.currentQuantity })}</label>
                            <input type="number" value={consumedQuantity} onChange={e => setConsumedQuantity(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100" required min="1" max={material.currentQuantity} disabled={isSubmitting} />
                        </div>
                        {productionCodeInput}
                        <h4 className="text-md font-semibold text-gray-800 pt-2 border-t mt-2">{t('actionModal.newLocationForRemainder')}</h4>
                        {locationSelector}
                    </>
                );
        }
    };
    
    if (isConfirming) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                    <div className="p-5">
                         <h3 className="text-xl font-semibold text-gray-800">{t('actionModal.confirmActionTitle')}</h3>
                         <p className="text-gray-600 mt-2">{t('actionModal.confirmMessage')}</p>
                         <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-4 rounded">
                             <div className="ml-3">
                                 <p className="text-sm text-yellow-800">
                                     <strong>{t('actionModal.action')}:</strong> {getTitle()} <br/>
                                     <strong>{t('actionModal.material')}:</strong> {material.materialCode}
                                     {actionType === 'PARTIAL_CONSUMPTION' && <span><br/><strong>{t('actionModal.consuming')}:</strong> {consumedQuantity} {t('actionModal.units')}</span>}
                                 </p>
                             </div>
                         </div>
                         {error && <p className="text-sm text-red-600 bg-red-100 p-2 rounded-md mb-4">{error}</p>}
                         <div className="pt-4 flex justify-end space-x-3">
                            <button type="button" onClick={() => setIsConfirming(false)} className="bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300 disabled:bg-gray-200" disabled={isSubmitting}>{t('common.cancel')}</button>
                            <button type="button" onClick={executeAction} className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 flex items-center justify-center disabled:bg-red-400" disabled={isSubmitting}>
                                {isSubmitting && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isSubmitting ? t('actionModal.confirming') : t('actionModal.yesConfirm')}
                            </button>
                         </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
         <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-5 border-b flex justify-between items-center">
                    <h3 className="text-xl font-semibold text-gray-800">{getTitle()}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={isSubmitting}>
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {renderFormFields()}
                    {error && <p className="text-sm text-red-600 bg-red-100 p-2 rounded-md">{error}</p>}
                    <div className="pt-4 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300 disabled:bg-gray-200" disabled={isSubmitting}>{t('common.cancel')}</button>
                        <button type="submit" className="bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 flex items-center justify-center disabled:bg-indigo-400" disabled={isSubmitting}>
                             {isSubmitting && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                             {isSubmitting ? t('actionModal.saving') : t('actionModal.confirmButton')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ActionModal;