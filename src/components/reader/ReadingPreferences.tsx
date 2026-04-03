import { useState } from 'react';
import { Type, Sun, Moon, Minus, Plus, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ReadingTheme = 'default' | 'sepia' | 'light';
export type FontFamily = 'sans' | 'serif' | 'mono';

export interface ReadingPrefs {
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
  theme: ReadingTheme;
  focusMode: boolean;
}

const defaultPrefs: ReadingPrefs = {
  fontSize: 16,
  lineHeight: 1.8,
  fontFamily: 'sans',
  theme: 'default',
  focusMode: false,
};

export function useReadingPrefs() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => {
    try {
      const saved = localStorage.getItem('reading-prefs');
      return saved ? { ...defaultPrefs, ...JSON.parse(saved) } : defaultPrefs;
    } catch {
      return defaultPrefs;
    }
  });

  const updatePrefs = (updates: Partial<ReadingPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('reading-prefs', JSON.stringify(next));
      return next;
    });
  };

  return { prefs, updatePrefs };
}

interface ReadingPreferencesProps {
  prefs: ReadingPrefs;
  onUpdate: (updates: Partial<ReadingPrefs>) => void;
}

const fontOptions: { key: FontFamily; label: string; style: string }[] = [
  { key: 'sans', label: 'Sans', style: 'font-sans' },
  { key: 'serif', label: 'Serif', style: 'font-serif' },
  { key: 'mono', label: 'Mono', style: 'font-mono' },
];

const themeOptions: { key: ReadingTheme; label: string; icon: typeof Sun; colors: string }[] = [
  { key: 'default', label: 'Dark', icon: Moon, colors: 'bg-[hsl(222,47%,8%)] border-border' },
  { key: 'sepia', label: 'Sepia', icon: Sun, colors: 'bg-[hsl(36,30%,88%)] border-[hsl(36,20%,70%)]' },
  { key: 'light', label: 'Light', icon: Sun, colors: 'bg-white border-gray-300' },
];

export function ReadingPreferences({ prefs, onUpdate }: ReadingPreferencesProps) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Type className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Reading Preferences</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-72 p-4 space-y-4" align="end">
        <h4 className="text-sm font-semibold text-foreground">Reading Preferences</h4>

        {/* Font Size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Font Size</span>
            <span className="text-xs font-mono text-foreground">{prefs.fontSize}px</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onUpdate({ fontSize: Math.max(12, prefs.fontSize - 1) })}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Slider
              value={[prefs.fontSize]}
              onValueChange={([v]) => onUpdate({ fontSize: v })}
              min={12}
              max={24}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onUpdate({ fontSize: Math.min(24, prefs.fontSize + 1) })}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Line Height */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Line Height</span>
            <span className="text-xs font-mono text-foreground">{prefs.lineHeight.toFixed(1)}</span>
          </div>
          <Slider
            value={[prefs.lineHeight]}
            onValueChange={([v]) => onUpdate({ lineHeight: v })}
            min={1.2}
            max={2.4}
            step={0.1}
          />
        </div>

        {/* Font Family */}
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Font</span>
          <div className="flex gap-1.5">
            {fontOptions.map(f => (
              <button
                key={f.key}
                onClick={() => onUpdate({ fontFamily: f.key })}
                className={cn(
                  'flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors',
                  f.style,
                  prefs.fontFamily === f.key
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <div className="flex gap-1.5">
            {themeOptions.map(t => (
              <button
                key={t.key}
                onClick={() => onUpdate({ theme: t.key })}
                className={cn(
                  'flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors flex items-center justify-center gap-1.5',
                  prefs.theme === t.key
                    ? 'ring-2 ring-primary/50'
                    : '',
                  t.colors
                )}
              >
                <span className={cn(
                  'w-4 h-4 rounded-full border',
                  t.colors
                )} />
                <span className={cn(
                  t.key === 'default' ? 'text-foreground' : 'text-gray-700'
                )}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Focus Mode Toggle */}
        <button
          onClick={() => onUpdate({ focusMode: !prefs.focusMode })}
          className={cn(
            'w-full flex items-center gap-2 py-2 px-3 rounded-md text-xs font-medium border transition-colors',
            prefs.focusMode
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-muted/30 border-border text-muted-foreground hover:text-foreground'
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Focus Mode
          <span className="ml-auto text-[10px] opacity-70">{prefs.focusMode ? 'ON' : 'OFF'}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Returns inline style + class overrides for the content area based on prefs */
export function getContentStyles(prefs: ReadingPrefs) {
  const fontClass =
    prefs.fontFamily === 'serif' ? 'font-serif' :
    prefs.fontFamily === 'mono' ? 'font-mono' :
    'font-sans';

  const themeClass =
    prefs.theme === 'sepia' ? 'reader-theme-sepia' :
    prefs.theme === 'light' ? 'reader-theme-light' :
    '';

  return {
    style: {
      fontSize: `${prefs.fontSize}px`,
      lineHeight: `${prefs.lineHeight}`,
    } as React.CSSProperties,
    className: cn(fontClass, themeClass),
  };
}
