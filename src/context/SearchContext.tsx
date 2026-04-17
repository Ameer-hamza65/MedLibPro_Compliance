import React, { createContext, useContext, useState, ReactNode } from 'react';
import { trackSearch } from '@/lib/analytics';

interface AIResult {
  bookId: string;
  title: string;
  reason: string;
  specialty: string;
  collection?: string;
  relevanceScore?: number;
  chapters?: Array<{ id: string; title: string; reason: string }>;
}

interface SearchState {
  query: string;
  mode: 'keyword' | 'ai';
  aiResults: AIResult[];
  hasSearched: boolean;
  ftsResults: { books: any[]; chapters: any[] } | null;
}

interface SearchContextType {
  search: SearchState;
  setSearch: (s: Partial<SearchState>) => void;
  clearSearch: () => void;
}

const defaultState: SearchState = {
  query: '',
  mode: 'keyword',
  aiResults: [],
  hasSearched: false,
  ftsResults: null,
};

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [search, setSearchState] = useState<SearchState>(defaultState);

  const setSearch = (partial: Partial<SearchState>) => {
    setSearchState(prev => {
      const next = { ...prev, ...partial };
      // Log a search event whenever a new query is committed (hasSearched flips true or query changes)
      if (
        partial.query &&
        partial.query.trim() &&
        (partial.hasSearched === true || partial.mode || partial.aiResults || partial.ftsResults) &&
        partial.query !== prev.query
      ) {
        const isHome = typeof window !== 'undefined' && window.location.pathname === '/';
        trackSearch(partial.query, isHome ? 'homepage' : 'discovery', {
          resultCount:
            (partial.aiResults?.length ?? 0) +
            (partial.ftsResults?.books?.length ?? 0) +
            (partial.ftsResults?.chapters?.length ?? 0),
        });
      }
      return next;
    });
  };

  const clearSearch = () => setSearchState(defaultState);

  return (
    <SearchContext.Provider value={{ search, setSearch, clearSearch }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used within SearchProvider');
  return ctx;
}
