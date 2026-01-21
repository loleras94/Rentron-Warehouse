import React, { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import * as api from "../api/client";
import type { Language } from "../src/types";

const AccountSettingsView: React.FC = () => {
  const { t, language, changeLanguage } = useTranslation();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async () => {
    if (newPassword.length < 4) {
      alert("Password must be at least 4 characters");
      return;
    }

    if (newPassword !== confirm) {
      alert("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await api.updateMyPassword(oldPassword, newPassword);
      alert("Password updated successfully");
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      alert(err.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageChange = (lang: Language) => {
    changeLanguage(lang);
    localStorage.setItem("preferred_lang", lang);
    alert("Language changed");
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-4">{t("account.title")}</h2>

      {/* Language */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold">{t("account.language")}</h3>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => handleLanguageChange("en")}
            className={`px-4 py-2 rounded ${
              language === "en" ? "bg-indigo-600 text-white" : "bg-gray-200"
            }`}
          >
            English
          </button>

          <button
            onClick={() => handleLanguageChange("el")}
            className={`px-4 py-2 rounded ${
              language === "el" ? "bg-indigo-600 text-white" : "bg-gray-200"
            }`}
          >
            Ελληνικά
          </button>

          <button
            onClick={() => handleLanguageChange("ar")}
            className={`px-4 py-2 rounded ${
              language === "ar" ? "bg-indigo-600 text-white" : "bg-gray-200"
            }`}
          >
            العربية
          </button>


        </div>
      </div>

      {/* Password */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold">{t("account.changePassword")}</h3>

        <input
          type="password"
          placeholder={t("account.oldPassword")}
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          className="w-full mt-2 p-2 border rounded"
        />

        <input
          type="password"
          placeholder={t("account.newPassword")}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full mt-2 p-2 border rounded"
        />

        <input
          type="password"
          placeholder={t("account.confirmPassword")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full mt-2 p-2 border rounded"
        />

        <button
          disabled={loading}
          onClick={handlePasswordChange}
          className="mt-3 w-full bg-indigo-600 text-white px-4 py-2 rounded"
        >
          {t("account.savePassword")}
        </button>
      </div>
    </div>
  );
};

export default AccountSettingsView;
