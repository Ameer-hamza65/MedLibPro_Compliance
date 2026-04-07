import React, { createContext, useContext, useState, ReactNode } from 'react';

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
    setSearchState(prev => ({ ...prev, ...partial }));
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
