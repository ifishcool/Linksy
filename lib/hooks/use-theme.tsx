'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  const resolvedTheme: 'light' | 'dark' = 'light';

  // Enforce light theme globally
  /* eslint-disable react-hooks/set-state-in-effect -- Theme enforcement must happen in effect */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    setThemeState('light');
    localStorage.setItem('theme', 'light');
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep API shape but normalize all theme requests to light
  const handleSetTheme = (_newTheme: Theme) => {
    setThemeState('light');
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.remove('dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
