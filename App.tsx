import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import OperatorView from './components/OperatorView';
import SearchView from './components/SearchView';
import ManagerView from './components/ManagerView';
import LoginView from './components/LoginView';
import { WarehouseProvider } from './context/WarehouseContext';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { useTranslation } from './hooks/useTranslation'; // Import useTranslation for translations
import BatchCreateView from './components/BatchCreateView';
import TransactionView from './components/TransactionView';
import OrderKeeperView from './components/OrderKeeperView';
import MachineOperatorView from './components/MachineOperatorView';
import InfraOperatorView from './components/InfraOperatorView';
import PhaseManagerView from './components/PhaseManagerView';
import PdfOrderImportView from './components/PdfOrderImportView';
import LivePhasesView from './components/LivePhasesView';
import { LanguageProvider } from './context/LanguageContext'; 
import AccountSettingsView from './components/AccountSettingsView';
import DeadTimeView from "./components/DeadTimeView";
import FramesView from './components/FramesView';
import MaterialUseView from "./components/MaterialUseView";
import MultiJobOperatorView from "./components/MultiJobOperatorView";

type View =
  | 'operator'
  | 'search'
  | 'manager'
  | 'batch-create'
  | 'transactions'
  | 'orders'
  | 'scan-product-sheet'
  | 'daily-logs'
  | 'phase-manager'
  | 'pdf-import'
  | 'live-phases'
  | 'history'
  | 'account'
  | 'dead-time'
  | 'frames'
  | 'material-use'
  | 'multi-jobs';

const AuthenticatedApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('batch-create');

  useEffect(() => {
    // Set initial view based on user permissions
    if (user && user.allowedTabs.length > 0) {
      setCurrentView(user.allowedTabs[0]);
    }
  }, [user]);

  if (!user) {
    return null; // Should not happen if this component is rendered
  }
  
  const renderView = () => {
    // Ensure user can only see views they are allowed to
    if (!user.allowedTabs.includes(currentView)) {
        // Fallback to the first allowed tab if current view is not permitted
        const fallbackView = user.allowedTabs[0];
        if (fallbackView) setCurrentView(fallbackView);
        return null;
    }

    switch (currentView) {
      case 'operator':
        return <OperatorView />;
      case 'search':
        return <SearchView />;
      case 'manager':
        return <ManagerView />;
      case 'batch-create':
        return <BatchCreateView />;
      case 'transactions':
        return <TransactionView />;
      case 'orders':
        return <OrderKeeperView />;
      case 'scan-product-sheet':
        return <MachineOperatorView />;
      case 'daily-logs':
        return <InfraOperatorView />;
      case 'phase-manager':
        return <PhaseManagerView />;
      case "pdf-import":
        return <PdfOrderImportView />;
      case "live-phases":
        return <LivePhasesView />; 
      case "account":
        return <AccountSettingsView />; 
      case "dead-time":
        return <DeadTimeView />;   
      case "frames":
        return <FramesView />;   
      case "material-use":
        return <MaterialUseView />;  
      case "multi-jobs":
        return <MultiJobOperatorView />;      
      default:
        // A user's default view might not be in the nav, but still valid.
        // If not, redirect to first allowed tab.
        const defaultView = user.allowedTabs[0];
        if (defaultView && currentView !== defaultView) {
            setCurrentView(defaultView);
        }
        return <p>Loading...</p>;
    }
  };

  return (
    <WarehouseProvider>
      <div className="min-h-screen bg-gray-50 font-sans text-gray-800">
        <Header 
            currentView={currentView} 
            setCurrentView={setCurrentView} 
            allowedTabs={user.allowedTabs}
            username={user.username}
            logout={logout}
        />
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {renderView()}
          </div>
        </main>
      </div>
    </WarehouseProvider>
  );
}

const AppContent: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();
  const { t, language } = useTranslation(); // 👈 add language

  useEffect(() => {
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl font-semibold text-gray-600">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LoginView />;
};


// Wrap the entire app in LanguageProvider to make the language context globally accessible
const App: React.FC = () => {
  return (
    <LanguageProvider> {/* Wrap the app with the LanguageProvider */}
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
