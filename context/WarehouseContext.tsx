import React, {
  createContext,
  useState,
  useEffect,
  ReactNode,
  useCallback
} from "react";

import type { Material, MaterialLocation } from "../src/types";

import {
  getMaterials,
  createMaterial,
  placeMaterial,
  moveMaterial,
  consumeMaterial
} from "../api/client";

interface WarehouseContextType {
  materials: Material[];
  loading: boolean;
  error: string | null;
  addMaterial: (materialCode: string, quantity: number) => Promise<Material>;
  findMaterialById: (id: string) => Material | null;
  updateMaterialLocation: (
    id: string,
    location: MaterialLocation,
    type: "PLACED" | "MOVED"
  ) => Promise<void>;
  updateMaterialConsumption: (
    id: string,
    productionCode: string,
	qty?: number
  ) => Promise<void>;
  updatePartialConsumption: (
    id: string,
    consumedQuantity: number,
    productionCode: string,
    newLocation: MaterialLocation
  ) => Promise<void>;
  refreshMaterials: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const WarehouseContext =
  createContext<WarehouseContextType | undefined>(undefined);

export const WarehouseProvider = ({ children }: { children: ReactNode }) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMaterials = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMaterials();
      setMaterials(data);
    } catch {
      setError("Failed to fetch materials.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMaterials();
  }, [refreshMaterials]);

  const addMaterial = async (materialCode: string, quantity: number) => {
    const newMaterial = await createMaterial(materialCode, quantity);
    await refreshMaterials();
    return newMaterial;
  };

  const findMaterialById = (id: string) =>
    materials.find((m) => m.id === id) || null;

  const updateMaterialLocation = async (
    id: string,
    location: MaterialLocation,
    type: "PLACED" | "MOVED"
  ) => {
    if (type === "PLACED") {
      await placeMaterial(id, location.area, location.position);
    } else {
      await moveMaterial(id, location.area, location.position);
    }
    await refreshMaterials();
  };

  const updateMaterialConsumption = async (
    id: string,
    productionCode: string,
	qty?: number
  ) => {
    await consumeMaterial(id, qty ?? Infinity, productionCode);
    await refreshMaterials();
  };

  const updatePartialConsumption = async (
    id: string,
    consumedQty: number,
    productionCode: string,
    newLocation: MaterialLocation
  ) => {
    await consumeMaterial(id, consumedQty, productionCode, newLocation);
    await refreshMaterials();
  };

  return (
    <WarehouseContext.Provider
      value={{
        materials,
        loading,
        error,
        addMaterial,
        findMaterialById,
        updateMaterialLocation,
        updateMaterialConsumption,
        updatePartialConsumption,
        refreshMaterials,
        refresh: refreshMaterials
      }}
    >
      {children}
    </WarehouseContext.Provider>
  );
};
