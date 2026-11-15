import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DashboardApp } from './app';
import { initThemeSync } from '@/src/lib/theme';
import '@/src/index.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';

initThemeSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
