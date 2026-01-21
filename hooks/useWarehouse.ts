import { useContext } from "react";
import { WarehouseContext } from "../context/WarehouseContext";
import * as api from "../api/client"; // <-- IMPORTANT

export const useWarehouse = () => {
  const context = useContext(WarehouseContext);
  if (!context) {
    throw new Error("useWarehouse must be used within a WarehouseProvider");
  }

  return {
    ...context,

    // 🔍 Returns from LOCAL state
    findMaterialById: (id: string) =>
      context.materials.find((m) => m.id === id) || null,

    // 🔍 Always fetches from backend
    findMaterialByIdOnline: async (id: string) => {
      try {
        const mat = await api.getMaterial(id);  // <-- correct function!
        return mat || null;
      } catch {
        return null;
      }
    },
  };
};
