import { useState, useCallback } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface SidebarAIInputProps {
  onAsk: (question: string) => void;
  isLoading?: boolean;
  lastAnswer?: string;
}

export function SidebarAIInput({ onAsk, isLoading = false, lastAnswer }: SidebarAIInputProps) {
  const [question, setQuestion] = useState('');

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!question.trim() || isLoading) return;
    onAsk(question.trim());
    setQuestion('');
  }, [question, isLoading, onAsk]);

  return (
    <div className="px-4 py-3 border-b border-border/50">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-sm font-semibold text-foreground">Reading assistant</span>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">Beta</Badge>
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <Input
          placeholder="Ask about this chapter"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="h-8 text-xs"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="h-8 w-8 flex-shrink-0"
          disabled={!question.trim() || isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5 text-accent" />
          )}
        </Button>
      </form>
      {lastAnswer && (
        <div className="mt-2 p-2 rounded-md bg-accent/5 border border-accent/10 text-xs text-muted-foreground leading-relaxed max-h-32 overflow-y-auto">
          {lastAnswer}
        </div>
      )}
    </div>
  );
}
