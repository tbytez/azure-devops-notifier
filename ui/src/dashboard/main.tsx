import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DashboardApp } from './app';
import { initThemeSync } from '@/src/lib/theme';
import '@/src/index.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';

initThemeSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
