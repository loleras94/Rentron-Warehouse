import React from "react";
import type { View, AllowedView } from "../src/types";
import { useTranslation } from "../hooks/useTranslation";

interface HeaderProps {
  currentView: View;
  setCurrentView: React.Dispatch<React.SetStateAction<View>>;
  allowedTabs: AllowedView[];
  username: string;
  logout: () => void;
}

const Header: React.FC<HeaderProps> = ({
  currentView,
  setCurrentView,
  allowedTabs,
  username,
  logout,
}) => {
  const { t } = useTranslation();

  // ✅ No icons, just labels
  const allNavItems: Array<{ id: AllowedView; label: string }> = [
    { id: "orders", label: t("tabs.orders") },
    { id: "pdf-import", label: t("tabs.pdf-import") },
    { id: "scan-product-sheet", label: t("tabs.scan-product-sheet") },
    { id: "multi-jobs", label: t("tabs.multi-jobs") },
    { id: "material-use", label: t("tabs.material-use") },
    { id: "daily-logs", label: t("tabs.daily-logs") },
    { id: "phase-manager", label: t("tabs.phase-manager") },
    { id: "live-phases", label: t("tabs.live-phases") },
    { id: "dead-time", label: t("tabs.dead-time") },
    { id: "batch-create", label: t("tabs.batch-create") },
    { id: "frames", label: t("tabs.frames") },
    { id: "operator", label: t("tabs.operator") },
    { id: "search", label: t("tabs.search") },
    { id: "transactions", label: t("tabs.transactions") },
    { id: "manager", label: t("tabs.manager") },
    { id: "account", label: t("tabs.account") },
  ];

  // Show only allowed tabs
  const navItems = allNavItems.filter((item) =>
    allowedTabs.includes(item.id)
  );

  return (
    <header className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 mr-3 text-indigo-600"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM8 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1H9a1 1 0 01-1-1V4zM15 3a1 1 0 00-1 1v12a1 1 0 001 1h2a1 1 0 001-1V4a1 1 0 00-1-1h-2z" />
            </svg>
            {t("header.title")}
          </h1>

          <div className="flex items-center gap-4">
            {/* ✅ Desktop Nav: WRAPS */}
            <nav className="hidden md:flex flex-wrap gap-2 justify-end">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id as View)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                    currentView === item.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-gray-600 hover:bg-indigo-50 hover:text-indigo-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center">
              <span className="text-sm text-gray-500 mr-3 hidden sm:inline">
                {t("header.welcome")}, <strong>{username}</strong>
              </span>

              {/* ✅ Simple logout button, no icon */}
              <button
                onClick={logout}
                className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                title={t("header.logout")}
              >
                {t("header.logout")}
              </button>
            </div>
          </div>
        </div>

        {/* ✅ Mobile Nav (no icons) */}
        <div className="md:hidden">
          <div className="grid grid-cols-2 gap-2 pb-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id as View)}
                className={`px-3 py-3 rounded-md text-sm font-medium transition-colors duration-200 ${
                  currentView === item.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-200 text-gray-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
