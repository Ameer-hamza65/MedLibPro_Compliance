import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Hardcoded discipline taxonomy — Nursing pinned first as the platform's primary discipline.
export const DISCIPLINES = [
  'Nursing',
  'Medicine',
  'Pharmacy',
  'Allied Health',
  'Dentistry',
  'Public Health',
  'All Disciplines',
] as const;

export type Discipline = (typeof DISCIPLINES)[number];

interface SearchFiltersProps {
  years: number[];
  specialties: string[];
  selectedYear: string;
  selectedSpecialty: string;
  selectedDiscipline: Discipline;
  recentOnly: boolean;
  onYearChange: (year: string) => void;
  onSpecialtyChange: (specialty: string) => void;
  onDisciplineChange: (discipline: Discipline) => void;
  onRecentToggle: (recent: boolean) => void;
  /** Variant: 'sidebar' (vertical, used in left rail / mobile sheet) or 'inline' (legacy). */
  variant?: 'sidebar' | 'inline';
  activeFilterCount?: number;
  onClearAll?: () => void;
}

export function SearchFilters({
  years, specialties,
  selectedYear, selectedSpecialty, selectedDiscipline, recentOnly,
  onYearChange, onSpecialtyChange, onDisciplineChange, onRecentToggle,
  variant = 'sidebar',
  activeFilterCount = 0,
  onClearAll,
}: SearchFiltersProps) {
  if (variant === 'inline') {
    // Legacy horizontal layout, kept for backward compat.
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Discipline:</span>
          {DISCIPLINES.map((d) => {
            const isActive = selectedDiscipline === d;
            const isNursing = d === 'Nursing';
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDisciplineChange(d)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs border transition-colors',
                  isActive ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
                  isNursing && !isActive && 'font-bold text-blue-800 border-blue-300 bg-blue-50',
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Sidebar variant (default): vertical, accordion-grouped.
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Filters</h3>
          {activeFilterCount > 0 && (
            <Badge className="bg-blue-700 text-white hover:bg-blue-700 h-5 min-w-5 px-1.5 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </div>
        {activeFilterCount > 0 && onClearAll && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-slate-600 hover:text-blue-700"
            onClick={onClearAll}
          >
            <X className="h-3 w-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      <Accordion
        type="multiple"
        defaultValue={['discipline', 'category', 'year']}
        className="space-y-2"
      >
        {/* Discipline */}
        <AccordionItem value="discipline" className="border-b-0">
          <AccordionTrigger className="text-xs font-semibold text-slate-500 uppercase tracking-wide hover:no-underline py-2">
            Discipline
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <div className="space-y-1.5 pt-1">
              {DISCIPLINES.map((d) => {
                const isActive = selectedDiscipline === d;
                const isNursing = d === 'Nursing';
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onDisciplineChange(d)}
                    className={cn(
                      'w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between gap-2',
                      isActive
                        ? 'bg-blue-700 text-white font-medium'
                        : 'text-slate-700 hover:bg-slate-100',
                      isNursing && !isActive && 'font-bold text-blue-800 bg-blue-50 hover:bg-blue-100',
                    )}
                  >
                    <span>{d}</span>
                    {isNursing && (
                      <span className={cn(
                        'text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded',
                        isActive ? 'bg-white/20 text-white' : 'bg-blue-700 text-white',
                      )}>
                        Featured
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Category */}
        <AccordionItem value="category" className="border-b-0">
          <AccordionTrigger className="text-xs font-semibold text-slate-500 uppercase tracking-wide hover:no-underline py-2">
            Category
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <div className="space-y-1 pt-1 max-h-64 overflow-y-auto pr-1">
              <label
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-slate-100',
                  selectedSpecialty === 'all' && 'bg-blue-50 text-blue-800 font-medium',
                )}
              >
                <Checkbox
                  checked={selectedSpecialty === 'all'}
                  onCheckedChange={() => onSpecialtyChange('all')}
                  className="h-3.5 w-3.5"
                />
                <span>All Categories</span>
              </label>
              {specialties.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-slate-100',
                    selectedSpecialty === s && 'bg-blue-50 text-blue-800 font-medium',
                  )}
                >
                  <Checkbox
                    checked={selectedSpecialty === s}
                    onCheckedChange={() => onSpecialtyChange(selectedSpecialty === s ? 'all' : s)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate">{s}</span>
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Year */}
        <AccordionItem value="year" className="border-b-0">
          <AccordionTrigger className="text-xs font-semibold text-slate-500 uppercase tracking-wide hover:no-underline py-2">
            Publication Year
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <Select value={selectedYear} onValueChange={onYearChange}>
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue placeholder="All Years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 mt-3 px-1">
              <Switch
                id="recent-sidebar"
                checked={recentOnly}
                onCheckedChange={onRecentToggle}
              />
              <Label htmlFor="recent-sidebar" className="text-xs cursor-pointer text-slate-700">
                Recent uploads first
              </Label>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
