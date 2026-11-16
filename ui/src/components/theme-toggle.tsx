import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { currentTheme, onThemeChange, setTheme, type ThemeName } from '@/src/lib/theme';

export function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeName>(currentTheme());

  useEffect(() => onThemeChange(setThemeState), []);

  const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <Button
      type="button"
      variant="ghost"
      size="iconSm"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <span key={theme} className="enter inline-flex">
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </span>
    </Button>
  );
}
