import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface SearchFiltersProps {
  years: number[];
  specialties: string[];
  selectedYear: string;
  selectedSpecialty: string;
  recentOnly: boolean;
  onYearChange: (year: string) => void;
  onSpecialtyChange: (specialty: string) => void;
  onRecentToggle: (recent: boolean) => void;
}

export function SearchFilters({
  years, specialties,
  selectedYear, selectedSpecialty, recentOnly,
  onYearChange, onSpecialtyChange, onRecentToggle,
}: SearchFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select value={selectedYear} onValueChange={onYearChange}>
        <SelectTrigger className="w-[140px] h-9 text-xs">
          <SelectValue placeholder="All Years" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Years</SelectItem>
          {years.map(y => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedSpecialty} onValueChange={onSpecialtyChange}>
        <SelectTrigger className="w-[180px] h-9 text-xs">
          <SelectValue placeholder="All Categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {specialties.map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Switch id="recent" checked={recentOnly} onCheckedChange={onRecentToggle} />
        <Label htmlFor="recent" className="text-xs cursor-pointer">Recent Uploads</Label>
      </div>
    </div>
  );
}
