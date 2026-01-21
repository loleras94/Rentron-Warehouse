import React, { useEffect, useState } from "react";
import * as api from "../api/client";
import { useTranslation } from "../hooks/useTranslation";

interface Phase {
  id: string;
  name: string;
}

const PhaseManagerView: React.FC = () => {
  const { t } = useTranslation();
  const [phases, setPhases] = useState<Phase[]>([]);
  const [newPhase, setNewPhase] = useState({ id: "", name: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);

  const loadPhases = async () => {
    setIsLoading(true);
    try {
      const data = await api.getPhases();
      setPhases(data);
    } catch (err) {
      console.error(err);
      alert(t("phaseManager.loadingError"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPhases();
  }, []);

  const handleAddPhase = async () => {
    if (!newPhase.id.trim() || !newPhase.name.trim()) return;

    await api.createPhase(newPhase.id.trim(), newPhase.name.trim());
    setNewPhase({ id: "", name: "" });
    await loadPhases();
  };

  const handleUpdatePhase = async () => {
    if (!editingPhase) return;

    await api.updatePhase(editingPhase.id, editingPhase.name);
    setEditingPhase(null);
    await loadPhases();
  };

  const handleDeletePhase = async (id: string) => {
    if (!window.confirm(t("phaseManager.confirmDelete"))) return;

    await api.deletePhase(id);
    await loadPhases();
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        {t("phaseManager.title")}
      </h2>

      {isLoading && <p>{t("common.loading")}</p>}

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">
          {t("phaseManager.addNewTitle")}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder={t("phaseManager.placeholders.code")}
            value={newPhase.id}
            onChange={(e) => setNewPhase({ ...newPhase, id: e.target.value })}
            className="input-style"
          />

          <input
            type="text"
            placeholder={t("phaseManager.placeholders.name")}
            value={newPhase.name}
            onChange={(e) => setNewPhase({ ...newPhase, name: e.target.value })}
            className="input-style"
          />

          <button onClick={handleAddPhase} className="btn-primary">
            {t("common.add")}
          </button>
        </div>
      </div>

      <h3 className="text-lg font-semibold mb-2">
        {t("phaseManager.listTitle")}
      </h3>

      <table className="min-w-full border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 border text-left">
              {t("phaseManager.table.code")}
            </th>
            <th className="px-4 py-2 border text-left">
              {t("phaseManager.table.name")}
            </th>
            <th className="px-4 py-2 border text-center">
              {t("phaseManager.table.actions")}
            </th>
          </tr>
        </thead>

        <tbody>
          {phases.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="px-4 py-2">{p.id}</td>

              <td className="px-4 py-2">
                {editingPhase?.id === p.id ? (
                  <input
                    value={editingPhase.name}
                    onChange={(e) =>
                      setEditingPhase({ ...editingPhase, name: e.target.value })
                    }
                    className="input-style"
                  />
                ) : (
                  p.name
                )}
              </td>

              <td className="px-4 py-2 text-center">
                {editingPhase?.id === p.id ? (
                  <button
                    onClick={handleUpdatePhase}
                    className="btn-primary text-sm"
                  >
                    {t("phaseManager.buttons.save")}
                  </button>
                ) : (
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={() => setEditingPhase(p)}
                      className="btn-secondary text-sm"
                    >
                      {t("phaseManager.buttons.edit")}
                    </button>

                    <button
                      onClick={() => handleDeletePhase(p.id)}
                      className="btn-secondary text-sm text-red-600"
                    >
                      {t("phaseManager.buttons.delete")}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .input-style {
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          width: 100%;
        }
        .btn-primary {
          background-color: #4f46e5;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
        }
        .btn-secondary {
          background-color: #e5e7eb;
          color: #374151;
          padding: 0.4rem 0.8rem;
          border-radius: 0.375rem;
        }
      `}</style>
    </div>
  );
};

export default PhaseManagerView;
