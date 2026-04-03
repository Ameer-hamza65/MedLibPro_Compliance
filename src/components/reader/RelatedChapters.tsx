import { useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Chapter } from '@/data/mockEpubData';

interface RelatedChaptersProps {
  chapters: Chapter[];
  currentChapterId: string;
  currentTags: string[];
  onNavigate: (chapter: Chapter) => void;
}

export function RelatedChapters({ chapters, currentChapterId, currentTags, onNavigate }: RelatedChaptersProps) {
  const related = useMemo(() => {
    if (!currentTags || currentTags.length === 0) return [];
    const tagSet = new Set(currentTags.map(t => t.toLowerCase()));
    
    return chapters
      .filter(ch => ch.id !== currentChapterId && ch.tags && ch.tags.length > 0)
      .map(ch => {
        const overlap = ch.tags!.filter(t => tagSet.has(t.toLowerCase()));
        return { chapter: ch, score: overlap.length, matchingTags: overlap };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [chapters, currentChapterId, currentTags]);

  if (related.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-border/50">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Related Chapters</h3>
      </div>
      <div className="grid gap-3">
        {related.map(({ chapter, matchingTags }) => (
          <button
            key={chapter.id}
            onClick={() => onNavigate(chapter)}
            className="text-left p-3 rounded-lg border border-border/50 hover:border-accent/30 hover:bg-accent/5 transition-all"
          >
            <p className="text-sm font-medium text-foreground">{chapter.title}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {matchingTags.slice(0, 4).map(tag => (
                <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
