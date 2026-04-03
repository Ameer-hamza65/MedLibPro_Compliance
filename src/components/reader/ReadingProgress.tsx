import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface ReadingProgressProps {
  totalChapters: number;
  currentChapterIndex: number;
  scrollProgress: number; // 0-100 within current chapter
}

export function ReadingProgressBar({ totalChapters, currentChapterIndex, scrollProgress }: ReadingProgressProps) {
  const overallProgress = useMemo(() => {
    if (totalChapters === 0) return 0;
    const chapterWeight = 100 / totalChapters;
    return Math.min(100, (currentChapterIndex * chapterWeight) + (scrollProgress / 100 * chapterWeight));
  }, [totalChapters, currentChapterIndex, scrollProgress]);

  return (
    <div className="w-full h-[3px] bg-border/30 relative overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300 ease-out"
        style={{ width: `${overallProgress}%` }}
      />
    </div>
  );
}

interface ChapterProgressDotsProps {
  chapters: { id: string; title: string }[];
  currentChapterId: string;
  className?: string;
}

export function ChapterProgressDots({ chapters, currentChapterId, className }: ChapterProgressDotsProps) {
  const currentIdx = chapters.findIndex(c => c.id === currentChapterId);

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {chapters.slice(0, 20).map((ch, idx) => (
        <div
          key={ch.id}
          className={cn(
            'rounded-full transition-all duration-200',
            idx === currentIdx
              ? 'w-3 h-1.5 bg-primary'
              : idx < currentIdx
                ? 'w-1.5 h-1.5 bg-primary/40'
                : 'w-1.5 h-1.5 bg-border'
          )}
          title={ch.title}
        />
      ))}
      {chapters.length > 20 && (
        <span className="text-[9px] text-muted-foreground ml-1">+{chapters.length - 20}</span>
      )}
    </div>
  );
}
