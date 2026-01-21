import React, { createContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { Language } from '../src/types';

// Load translations asynchronously (NO top-level await)
async function loadTranslations() {
  const [en, el, ar] = await Promise.all([
    fetch("./locales/en.json").then(r => r.json()),
    fetch("./locales/el.json").then(r => r.json()),
    fetch("./locales/ar.json").then(r => r.json()),
  ]);
  return { en, el, ar };
}

interface LanguageContextType {
  language: Language;
  changeLanguage: (lang: Language) => void;
  t: (key: string, options?: Record<string, string | number>) => string;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Helper to get nested translation (a.b.c)
const getNestedTranslation = (obj: any, path: string): string | undefined =>
  path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    // Fetch language from localStorage or default to 'en'
    const stored = localStorage.getItem('appLanguage');
    return stored === 'en' || stored === 'el' || stored === 'ar' ? stored : 'en';
  });

  const [translations, setTranslations] = useState<{ en: any; el: any; ar: any } | null>(null);

  // Load translations ONCE on mount
  useEffect(() => {
    loadTranslations().then(setTranslations);
  }, []);

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('appLanguage', lang); // Persist language choice
  };

  const t = useCallback(
    (key: string, options?: Record<string, string | number>): string => {
      if (!translations) return key; // translations not loaded yet

      let translation = getNestedTranslation(translations[language], key);

      if (!translation) {
        translation = getNestedTranslation(translations.en, key) || key;
      }

      if (options) {
        Object.entries(options).forEach(([k, v]) => {
          translation = translation!.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
        });
      }

      return translation;
    },
    [language, translations]
  );

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
