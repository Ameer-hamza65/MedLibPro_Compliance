import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Sparkles, Type, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { CatalogCard, isCuratedCollection, getBookPrice } from '@/components/CatalogCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { AISearchResults } from '@/components/AISearchResults';
import { SearchFilters, type Discipline } from '@/components/SearchFilters';

// Map disciplines → keywords matched against book.specialty / tags / title.
const DISCIPLINE_KEYWORDS: Record<Exclude<Discipline, 'All Disciplines'>, string[]> = {
  Nursing: ['nursing', 'nurse', 'midwifery', 'patient care'],
  Medicine: ['medicine', 'medical', 'clinical', 'internal', 'surgery', 'cardiology', 'oncology', 'pediatric'],
  Pharmacy: ['pharmacy', 'pharmacology', 'drug', 'medication', 'pharmaceutical'],
  'Allied Health': ['therapy', 'therapist', 'rehabilitation', 'radiology', 'imaging', 'laboratory', 'dietetic', 'nutrition'],
  Dentistry: ['dental', 'dentistry', 'orthodont', 'oral'],
  'Public Health': ['public health', 'epidemiology', 'compliance', 'guideline', 'policy', 'safety', 'infection'],
};

function bookMatchesDiscipline(
  book: { specialty?: string; tags?: string[]; title?: string },
  discipline: Discipline,
): boolean {
  if (discipline === 'All Disciplines') return true;
  const haystack = [
    book.specialty || '',
    (book.tags || []).join(' '),
    book.title || '',
  ].join(' ').toLowerCase();
  return DISCIPLINE_KEYWORDS[discipline].some((kw) => haystack.includes(kw));
}

type SortOption = 'relevance' | 'title-asc' | 'title-desc' | 'price-asc' | 'price-desc';

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
  const [selectedDiscipline, setSelectedDiscipline] = useState<Discipline>('Nursing');
  const [recentOnly, setRecentOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const years = useMemo(() => {
    const ySet = new Set(books.map(b => b.publishedYear).filter(Boolean));
    return Array.from(ySet).sort((a, b) => b - a);
  }, [books]);

  const booksById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);

  const specialties = useMemo(() => {
    const sSet = new Set(books.map(b => b.specialty).filter(Boolean));
    return Array.from(sSet).sort();
  }, [books]);

  // Simple keyword search: metadata locally + chapter content from DB (debounced via setTimeout).
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
      filtered = filtered.filter(b => bookMatchesDiscipline(b, selectedDiscipline));
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
    ftsResults.chapters.forEach(ch => bookIdSet.add(ch.book_id));

    let merged = books.filter(b => bookIdSet.has(b.id));
    merged = merged.filter(b => bookMatchesDiscipline(b, selectedDiscipline));

    if (selectedYear !== 'all') {
      merged = merged.filter(b => b.publishedYear === Number(selectedYear));
    }
    if (selectedSpecialty !== 'all') {
      merged = merged.filter(b => b.specialty === selectedSpecialty);
    }

    // Sort by FTS rank (default — overridden later by sortBy if needed)
    const rankMap = new Map<string, number>();
    ftsResults.books.forEach(b => rankMap.set(b.id, b.rank));
    ftsResults.chapters.forEach(ch => {
      const existing = rankMap.get(ch.book_id) || 0;
      rankMap.set(ch.book_id, Math.max(existing, ch.rank * 0.8));
    });
    merged.sort((a, b) => (rankMap.get(b.id) || 0) - (rankMap.get(a.id) || 0));

    return merged;
  }, [books, searchTerm, ftsResults, selectedYear, selectedSpecialty, selectedDiscipline, recentOnly]);

  // Apply Sort By on top of keyword/relevance ordering.
  const sortedResults = useMemo(() => {
    if (sortBy === 'relevance') return keywordResults;
    const arr = [...keywordResults];
    switch (sortBy) {
      case 'title-asc':
        arr.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title-desc':
        arr.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'price-asc':
        arr.sort((a, b) => getBookPrice(a.id) - getBookPrice(b.id));
        break;
      case 'price-desc':
        arr.sort((a, b) => getBookPrice(b.id) - getBookPrice(a.id));
        break;
    }
    return arr;
  }, [keywordResults, sortBy]);

  // Active filter count (for the badge in the sidebar header)
  const activeFilterCount =
    (selectedDiscipline !== 'Nursing' ? 1 : 0) +
    (selectedSpecialty !== 'all' ? 1 : 0) +
    (selectedYear !== 'all' ? 1 : 0) +
    (recentOnly ? 1 : 0);

  const handleClearAllFilters = useCallback(() => {
    setSelectedDiscipline('Nursing');
    setSelectedSpecialty('all');
    setSelectedYear('all');
    setRecentOnly(false);
  }, []);

  const handleClearAllAndSearch = useCallback(() => {
    handleClearAllFilters();
    setSearchTerm('');
    setHasSearched(false);
    setAiResults([]);
    setFtsResults(null);
    clearSearchCtx();
  }, [handleClearAllFilters, clearSearchCtx]);

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

  // Sidebar filter content (shared between desktop aside and mobile sheet)
  const filtersNode = (
    <SearchFilters
      years={years}
      specialties={specialties}
      selectedYear={selectedYear}
      selectedSpecialty={selectedSpecialty}
      selectedDiscipline={selectedDiscipline}
      recentOnly={recentOnly}
      onYearChange={setSelectedYear}
      onSpecialtyChange={setSelectedSpecialty}
      onDisciplineChange={setSelectedDiscipline}
      onRecentToggle={setRecentOnly}
      activeFilterCount={activeFilterCount}
      onClearAll={handleClearAllFilters}
    />
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="text-center py-6 border-b border-slate-200">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
          <span className="font-black">More Knowledge.</span>{' '}
          <span className="font-normal text-slate-600">Less Cost.</span>{' '}
          <span className="font-black">One Platform.</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          150 publishers • 34 associations • AI-powered discovery
        </p>
      </section>

      <main className="container mx-auto px-4 py-6">
        {/* Global Discovery Search Bar */}
        <motion.form
          onSubmit={handleSearchSubmit}
          className="flex gap-2 mb-4 max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search by title, keyword, or topic..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-10 bg-white border-slate-300 text-sm"
              aria-label="Search the catalog"
            />
          </div>
          {searchMode === 'ai' && (
            <Button type="submit" disabled={!searchTerm.trim() || aiLoading} size="sm" className="bg-blue-700 hover:bg-blue-800 text-white h-10">
              <Sparkles className="h-3.5 w-3.5 mr-1" /> AI Search
            </Button>
          )}
          {(hasSearched || searchTerm) && (
            <Button type="button" variant="outline" size="sm" onClick={clearSearch} className="h-10">Clear</Button>
          )}
        </motion.form>

        {/* Search Mode Tabs */}
        <div className="flex justify-center mb-4">
          <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as 'keyword' | 'ai')}>
            <TabsList className="h-8">
              <TabsTrigger value="keyword" className="text-xs gap-1 px-3 h-7">
                <Type className="h-3 w-3" /> Keyword
              </TabsTrigger>
              <TabsTrigger value="ai" className="text-xs gap-1 px-3 h-7">
                <Sparkles className="h-3 w-3" /> AI Search
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* AI mode: full-width results, no sidebar needed */}
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
              <div className="text-center py-12 border border-dashed border-slate-300 rounded-lg bg-slate-50/50">
                <Search className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-slate-700 mb-1">No AI results found</h3>
                <p className="text-slate-500 text-sm mb-4">Try rephrasing your query.</p>
                <Button variant="outline" onClick={clearSearch}>Browse all titles</Button>
              </div>
            )}
          </div>
        )}

        {/* Keyword mode: sidebar + results layout */}
        {searchMode === 'keyword' && (
          <div className="flex gap-6">
            {/* Desktop sidebar */}
            <aside className="hidden lg:block w-64 flex-shrink-0">
              <div className="sticky top-4 rounded-lg border border-slate-200 bg-white p-4">
                {filtersNode}
              </div>
            </aside>

            {/* Results column */}
            <div className="flex-1 min-w-0">
              {/* Toolbar: mobile filter trigger + result count + sort */}
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  {/* Mobile filter sheet trigger */}
                  <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="lg:hidden h-9 gap-1.5">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Filters
                        {activeFilterCount > 0 && (
                          <Badge className="bg-blue-700 text-white hover:bg-blue-700 h-4 min-w-4 px-1 text-[10px] ml-1">
                            {activeFilterCount}
                          </Badge>
                        )}
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-[300px] sm:w-[340px] overflow-y-auto">
                      <SheetHeader>
                        <SheetTitle>Filters</SheetTitle>
                      </SheetHeader>
                      <div className="mt-4">{filtersNode}</div>
                    </SheetContent>
                  </Sheet>

                  <p className="text-xs text-slate-500">
                    Showing {sortedResults.length} of {books.length} titles
                    {searchTerm && ` matching "${searchTerm}"`}
                  </p>
                  {ftsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                </div>

                {/* Sort By */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 hidden sm:inline">Sort by:</span>
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                    <SelectTrigger className="h-9 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Relevance</SelectItem>
                      <SelectItem value="title-asc">Title (A–Z)</SelectItem>
                      <SelectItem value="title-desc">Title (Z–A)</SelectItem>
                      <SelectItem value="price-asc">Price (Low to High)</SelectItem>
                      <SelectItem value="price-desc">Price (High to Low)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Chapter content matches */}
              {searchTerm.trim() && ftsResults && ftsResults.chapters.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                    Chapter Content Matches ({ftsResults.chapters.length})
                  </h3>
                  <div className="grid gap-3">
                    {ftsResults.chapters.slice(0, 8).map((ch) => (
                      <div
                        key={ch.id}
                        className="p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => handleViewChapter(ch.book_id, ch.chapter_key, ch.title)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{ch.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              from <span className="font-medium">{ch.book_title}</span>
                              {ch.book_specialty && ` · ${ch.book_specialty}`}
                            </p>
                            <p
                              className="text-sm text-slate-500 mt-2 line-clamp-2 [&_mark]:bg-blue-100 [&_mark]:text-slate-900 [&_mark]:rounded-sm [&_mark]:px-0.5"
                              dangerouslySetInnerHTML={{ __html: ch.headline }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Empty state */}
              {sortedResults.length === 0 ? (
                <div className="text-center py-16 px-6 border border-dashed border-slate-300 rounded-lg bg-slate-50/50">
                  <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-white border border-slate-200 mb-4">
                    <Search className="h-5 w-5 text-slate-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">No titles match your current search criteria.</h3>
                  <p className="text-sm text-slate-500 mb-5 max-w-md mx-auto">
                    Try removing a filter, broadening your discipline, or clearing your search to browse the full catalog.
                  </p>
                  <Button
                    onClick={handleClearAllAndSearch}
                    className="bg-blue-700 hover:bg-blue-800 text-white"
                  >
                    <X className="h-4 w-4 mr-1.5" />
                    Clear all filters and search
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {sortedResults.map((book) => {
                    const collection = isCuratedCollection(book);
                    return (
                      <div
                        key={book.id}
                        className={collection ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}
                      >
                        <CatalogCard
                          book={book}
                          onView={handleView}
                          variant={collection ? 'collection' : 'book'}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI mode - browse when not searched */}
        {searchMode === 'ai' && !hasSearched && (
          <>
            <p className="text-xs text-slate-500 mb-4">
              Showing all {books.length} titles — use AI search above for intelligent results
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4">
              {books.map((book) => {
                const collection = isCuratedCollection(book);
                return (
                  <div
                    key={book.id}
                    className={collection ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-3' : ''}
                  >
                    <CatalogCard
                      book={book}
                      onView={handleView}
                      variant={collection ? 'collection' : 'book'}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
