import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Sparkles, Type, Loader2 } from 'lucide-react';
import { BookCard } from '@/components/BookCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AISearchResults } from '@/components/AISearchResults';
import { SearchFilters } from '@/components/SearchFilters';
import { EpubBook } from '@/data/mockEpubData';
import { useBooks } from '@/context/BookContext';
import { useUser } from '@/context/UserContext';
import { useSearch } from '@/context/SearchContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { buildBookMetadataText, buildHighlightedSnippet, getBookMetadataRank } from '@/lib/libraryKeywordSearch';

interface FTSBookResult {
  id: string;
  title: string;
  description: string;
  specialty: string;
  authors: string[];
  publisher: string;
  published_year: number;
  tags: string[];
  file_type: string;
  rank: number;
  headline: string;
}

interface FTSChapterResult {
  id: string;
  book_id: string;
  chapter_key: string;
  title: string;
  rank: number;
  headline: string;
  book_title: string;
  book_specialty: string;
  book_authors: string[];
}

interface KeywordChapterRow {
  id: string;
  book_id: string;
  chapter_key: string;
  title: string;
  content: string | null;
}

export default function Library() {
  const navigate = useNavigate();
  const { books } = useBooks();
  const { user } = useUser();
  const { toast } = useToast();
  const { search, setSearch, clearSearch: clearSearchCtx } = useSearch();

  const [searchTerm, setSearchTerm] = useState(search.query);
  const [searchMode, setSearchMode] = useState<'keyword' | 'ai'>(search.mode);
  const [aiResults, setAiResults] = useState(search.aiResults);
  const [aiLoading, setAiLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(search.hasSearched);

  // FTS keyword results
  const [ftsResults, setFtsResults] = useState<{ books: FTSBookResult[]; chapters: FTSChapterResult[] } | null>(search.ftsResults as any);
  const [ftsLoading, setFtsLoading] = useState(false);

  // Filters
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedSpecialty, setSelectedSpecialty] = useState('all');
  const [recentOnly, setRecentOnly] = useState(false);

  const years = useMemo(() => {
    const ySet = new Set(books.map(b => b.publishedYear).filter(Boolean));
    return Array.from(ySet).sort((a, b) => b - a);
  }, [books]);

  const booksById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);

  const specialties = useMemo(() => {
    const sSet = new Set(books.map(b => b.specialty).filter(Boolean));
    return Array.from(sSet).sort();
  }, [books]);

  // Simple keyword search: metadata locally + chapter content from DB
  useEffect(() => {
    if (searchMode !== 'keyword') return;
    const q = searchTerm.trim();
    if (!q) {
      setFtsResults(null);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setFtsLoading(true);

      const metadataMatches = books
        .map((book) => {
          const rank = getBookMetadataRank(book, q);
          if (!rank) return null;

          return {
            id: book.id,
            title: book.title,
            description: book.description,
            specialty: book.specialty,
            authors: book.authors,
            publisher: book.publisher,
            published_year: book.publishedYear,
            tags: book.tags || [],
            file_type: book.fileType || 'epub',
            rank,
            headline: buildHighlightedSnippet(buildBookMetadataText(book), q, 90),
          } satisfies FTSBookResult;
        })
        .filter((result): result is FTSBookResult => Boolean(result))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 20);

      if (!cancelled) {
        setFtsResults({ books: metadataMatches, chapters: [] });
      }

      try {
        const [titleRes, contentRes] = await Promise.all([
          supabase
            .from('book_chapters')
            .select('id, book_id, chapter_key, title, content')
            .ilike('title', `%${q}%`)
            .limit(20),
          supabase
            .from('book_chapters')
            .select('id, book_id, chapter_key, title, content')
            .ilike('content', `%${q}%`)
            .limit(20),
        ]);

        const chapterMap = new Map<string, FTSChapterResult>();
        const rawChapterMatches = [
          ...(((titleRes.data as KeywordChapterRow[] | null) || [])),
          ...(((contentRes.data as KeywordChapterRow[] | null) || [])),
        ];

        rawChapterMatches.forEach((chapter) => {
          const book = booksById.get(chapter.book_id);
          if (!book) return;

          const titleMatched = chapter.title.toLowerCase().includes(q.toLowerCase());
          const contentMatched = (chapter.content || '').toLowerCase().includes(q.toLowerCase());
          const rank = (titleMatched ? 2 : 0) + (contentMatched ? 1 : 0) + getBookMetadataRank(book, q) * 0.01;

          const nextResult: FTSChapterResult = {
            id: chapter.id,
            book_id: chapter.book_id,
            chapter_key: chapter.chapter_key,
            title: chapter.title,
            rank,
            headline: buildHighlightedSnippet(`${chapter.title} ${chapter.content || ''}`, q, 110),
            book_title: book.title,
            book_specialty: book.specialty,
            book_authors: book.authors,
          };

          const existing = chapterMap.get(chapter.id);
          if (!existing || nextResult.rank > existing.rank) {
            chapterMap.set(chapter.id, nextResult);
          }
        });

        const chapters = Array.from(chapterMap.values())
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 20);

        const chapterBookBoosts = new Map<string, number>();
        chapters.forEach((chapter) => {
          chapterBookBoosts.set(
            chapter.book_id,
            Math.max(chapterBookBoosts.get(chapter.book_id) || 0, chapter.rank * 30)
          );
        });

        const combinedBookMap = new Map(metadataMatches.map((book) => [book.id, book]));

        books.forEach((book) => {
          const chapterBoost = chapterBookBoosts.get(book.id) || 0;
          if (!chapterBoost) return;

          const baseRank = getBookMetadataRank(book, q);
          const existing = combinedBookMap.get(book.id);
          const rank = Math.max(existing?.rank || 0, baseRank + chapterBoost);

          combinedBookMap.set(book.id, {
            id: book.id,
            title: book.title,
            description: book.description,
            specialty: book.specialty,
            authors: book.authors,
            publisher: book.publisher,
            published_year: book.publishedYear,
            tags: book.tags || [],
            file_type: book.fileType || 'epub',
            rank,
            headline: existing?.headline || buildHighlightedSnippet(buildBookMetadataText(book), q, 90),
          });
        });

        if (!cancelled) {
          const finalResults = {
            books: Array.from(combinedBookMap.values()).sort((a, b) => b.rank - a.rank).slice(0, 20),
            chapters,
          };
          setFtsResults(finalResults);
          setSearch({ ftsResults: finalResults });
        }
      } catch {
        if (!cancelled) {
          setFtsResults({ books: metadataMatches, chapters: [] });
        }
      } finally {
        if (!cancelled) {
          setFtsLoading(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm, searchMode, books, booksById]);

  // Merged keyword results: FTS when searching, all books when browsing
  const keywordResults = useMemo(() => {
    const q = searchTerm.trim();

    // No query — show all books with filters
    if (!q || !ftsResults) {
      let filtered = [...books];
      if (selectedYear !== 'all') {
        filtered = filtered.filter(b => b.publishedYear === Number(selectedYear));
      }
      if (selectedSpecialty !== 'all') {
        filtered = filtered.filter(b => b.specialty === selectedSpecialty);
      }
      if (recentOnly) {
        filtered.sort((a, b) => (b.publishedYear || 0) - (a.publishedYear || 0));
      }
      return filtered;
    }

    // Merge FTS book results with local book objects
    const bookIdSet = new Set(ftsResults.books.map(b => b.id));
    // Also include books matched via chapter hits
    ftsResults.chapters.forEach(ch => bookIdSet.add(ch.book_id));

    let merged = books.filter(b => bookIdSet.has(b.id));

    if (selectedYear !== 'all') {
      merged = merged.filter(b => b.publishedYear === Number(selectedYear));
    }
    if (selectedSpecialty !== 'all') {
      merged = merged.filter(b => b.specialty === selectedSpecialty);
    }

    // Sort by FTS rank
    const rankMap = new Map<string, number>();
    ftsResults.books.forEach(b => rankMap.set(b.id, b.rank));
    ftsResults.chapters.forEach(ch => {
      const existing = rankMap.get(ch.book_id) || 0;
      rankMap.set(ch.book_id, Math.max(existing, ch.rank * 0.8));
    });
    merged.sort((a, b) => (rankMap.get(b.id) || 0) - (rankMap.get(a.id) || 0));

    return merged;
  }, [books, searchTerm, ftsResults, selectedYear, selectedSpecialty, recentOnly]);

  const handleAISearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = searchTerm.trim();
    if (!query) return;

    setHasSearched(true);
    setAiLoading(true);
    setAiResults([]);

    try {
      const bookCatalog = books.map(b => ({
        id: b.id,
        title: b.title,
        specialty: b.specialty,
        description: b.description.slice(0, 200),
        tags: b.tags?.slice(0, 8) || [],
        year: b.publishedYear,
        chapters: b.tableOfContents.slice(0, 15).map(ch => ({ id: ch.id, title: ch.title })),
      }));

      const { data, error } = await supabase.functions.invoke('gemini-ai', {
        body: {
          prompt: query,
          chapterContent: JSON.stringify(bookCatalog),
          chapterTitle: 'Book Catalog',
          bookTitle: 'Compliance Collections Library',
          type: 'search',
          userId: user.id || null,
          enterpriseId: user.enterpriseId || null,
        },
      });

      if (error) {
        const errMsg = typeof data === 'object' && data?.error ? data.error : error.message;
        if (errMsg?.includes('Rate limit') || errMsg?.includes('429')) {
          toast({ title: 'AI Busy', description: 'Please try again in a moment.', variant: 'destructive' });
        }
        setAiResults([]);
      } else if (data?.results && Array.isArray(data.results)) {
        const mapped = data.results.slice(0, 8).map((r: any) => ({
          bookId: r.bookId || '',
          title: r.title || '',
          reason: r.reason || '',
          specialty: r.specialty || '',
          collection: r.collection || null,
          relevanceScore: r.relevanceScore || 0,
          chapters: r.chapters || [],
        }));
        setAiResults(mapped);
        setSearch({ aiResults: mapped, hasSearched: true, query: searchTerm, mode: 'ai' });
      } else if (data?.content) {
        try {
          const jsonMatch = data.content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            setAiResults(parsed.slice(0, 8));
            setSearch({ aiResults: parsed.slice(0, 8), hasSearched: true, query: searchTerm, mode: 'ai' });
          }
        } catch {
          setAiResults([]);
        }
      }
    } catch {
      setAiResults([]);
    } finally {
      setAiLoading(false);
    }
  }, [searchTerm, books, user.id, user.enterpriseId, toast, setSearch]);

  const handleView = useCallback((book: EpubBook) => {
    if (book.filePath && book.fileType === 'epub') {
      navigate(`/reader?book=${book.id}&chapter=__book-info__`);
    } else if (book.tableOfContents && book.tableOfContents.length > 0) {
      navigate(`/reader?book=${book.id}&chapter=${book.tableOfContents[0].id}`);
    } else {
      navigate(`/reader?book=${book.id}&chapter=__book-info__`);
    }
  }, [navigate]);

  const handleViewBook = useCallback((bookId: string, title?: string) => {
    let book = books.find(b => b.id === bookId);
    if (!book && title) {
      book = books.find(b => b.title.toLowerCase() === title.toLowerCase());
    }
    if (book) {
      if (book.filePath && book.fileType === 'epub') {
        navigate(`/reader?book=${book.id}&chapter=__first__`);
        return;
      }
      navigate(`/reader?book=${book.id}&chapter=${book.tableOfContents[0]?.id || '__book-info__'}`);
    } else {
      toast({ title: 'Book not found', description: 'This book may still be processing.', variant: 'destructive' });
    }
  }, [books, navigate, toast]);

  const handleViewChapter = useCallback((bookId: string, chapterId: string, chapterTitle?: string) => {
    const book = books.find(b => b.id === bookId);
    if (!book) return;

    if (book.filePath && book.fileType === 'epub') {
      // For EPUB books, pass the chapter title so Reader can locate it in the EPUB TOC
      const titleParam = chapterTitle ? `&chapterTitle=${encodeURIComponent(chapterTitle)}` : '';
      navigate(`/reader?book=${bookId}&chapter=__find__${titleParam}`);
    } else {
      navigate(`/reader?book=${bookId}&chapter=${chapterId}`);
    }
  }, [books, navigate]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setHasSearched(false);
    setAiResults([]);
    setFtsResults(null);
    clearSearchCtx();
  }, [clearSearchCtx]);

  const handleSearchSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchMode === 'ai') {
      handleAISearch();
    }
  }, [searchMode, handleAISearch]);

  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-border bg-card">
        <div className="container py-8">
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-3xl font-bold text-foreground">Compliance Content Catalog</h1>
            <p className="text-muted-foreground mt-1">
              {books.length} titles across curated compliance collections
            </p>
          </motion.div>
        </div>
      </section>

      <main className="container py-8">
        {/* Search Mode Toggle */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }} className="mb-4">
          <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as 'keyword' | 'ai')}>
            <TabsList>
              <TabsTrigger value="keyword" className="gap-1.5">
                <Type className="h-3.5 w-3.5" />
                Keyword Search
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI Search
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </motion.div>

        {/* Search Bar */}
        <motion.form
          onSubmit={handleSearchSubmit}
          className="flex gap-3 mb-4"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchMode === 'ai'
                ? "Ask AI: e.g. 'infection control protocols' or 'OSHA workplace safety'"
                : "Search titles, authors, and chapter content..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          {searchMode === 'ai' && (
            <Button type="submit" disabled={!searchTerm.trim() || aiLoading}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              AI Search
            </Button>
          )}
          {(hasSearched || searchTerm) && (
            <Button type="button" variant="outline" onClick={clearSearch}>
              Clear
            </Button>
          )}
        </motion.form>

        {/* Keyword Filters */}
        {searchMode === 'keyword' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6">
            <SearchFilters
              years={years}
              specialties={specialties}
              selectedYear={selectedYear}
              selectedSpecialty={selectedSpecialty}
              recentOnly={recentOnly}
              onYearChange={setSelectedYear}
              onSpecialtyChange={setSelectedSpecialty}
              onRecentToggle={setRecentOnly}
            />
          </motion.div>
        )}

        {/* AI Results */}
        {searchMode === 'ai' && hasSearched && (
          <div className="mb-8">
            <AISearchResults
              recommendations={aiResults}
              loading={aiLoading}
              query={searchTerm}
              onViewBook={handleViewBook}
              onViewChapter={handleViewChapter}
            />
            {!aiLoading && aiResults.length === 0 && (
              <div className="text-center py-12 glass-card rounded-xl">
                <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-semibold mb-1">No AI results found</h3>
                <p className="text-muted-foreground text-sm mb-4">Try rephrasing your query</p>
                <Button variant="outline" onClick={clearSearch}>Browse All Titles</Button>
              </div>
            )}
          </div>
        )}

        {/* Keyword Results / Browse */}
        {searchMode === 'keyword' && (
          <>
            <div className="flex items-center gap-2 mb-6">
              <p className="text-sm text-muted-foreground">
                Showing {keywordResults.length} of {books.length} titles
                {searchTerm && ` matching "${searchTerm}"`}
              </p>
              {ftsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {/* Chapter content matches */}
            {searchTerm.trim() && ftsResults && ftsResults.chapters.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Chapter Content Matches ({ftsResults.chapters.length})
                </h3>
                <div className="grid gap-3">
                  {ftsResults.chapters.slice(0, 8).map((ch) => (
                    <div
                      key={ch.id}
                      className="p-4 rounded-lg border border-border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => handleViewChapter(ch.book_id, ch.chapter_key, ch.title)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{ch.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            from <span className="font-medium">{ch.book_title}</span>
                            {ch.book_specialty && ` · ${ch.book_specialty}`}
                          </p>
                          <p
                            className="text-sm text-muted-foreground mt-2 line-clamp-2 [&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
                            dangerouslySetInnerHTML={{ __html: ch.headline }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          rank {ch.rank.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {keywordResults.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-semibold mb-1">No books found</h3>
                <p className="text-muted-foreground text-sm mb-4">Try adjusting your filters or search term</p>
                <Button variant="outline" onClick={clearSearch}>Clear Filters</Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {keywordResults.map((book) => (
                  <div key={book.id}>
                    <BookCard book={book} onView={handleView} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* AI mode - browse when not searched */}
        {searchMode === 'ai' && !hasSearched && (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              Showing all {books.length} titles — use AI search above for intelligent results
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {books.map((book) => (
                <div key={book.id}>
                  <BookCard book={book} onView={handleView} />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
