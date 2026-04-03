import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { EpubBook } from '@/data/mockEpubData';
import { supabase } from '@/integrations/supabase/client';
import { useUser } from '@/context/UserContext';

interface BookContextType {
  books: EpubBook[];
  addBook: (book: EpubBook) => void;
  removeBook: (bookId: string) => void;
  updateBook: (bookId: string, updates: Partial<EpubBook>) => void;
  getBook: (bookId: string) => EpubBook | undefined;
  totalBooks: number;
  isLoading: boolean;
  refreshFromDB: () => Promise<void>;
}

const BookContext = createContext<BookContextType | undefined>(undefined);

export function BookProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<EpubBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, loading: authLoading } = useUser();
  const lastFetchedAt = useRef<number>(0);
  const CACHE_TTL = 60_000;

  const refreshFromDB = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetchedAt.current < CACHE_TTL) return;
    setIsLoading(true);
    try {
      const { data: dbBooks, error } = await supabase
        .from('books')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Could not fetch books from DB:', error.message);
        setBooks([]);
        return;
      }

      const convertedBooks: EpubBook[] = (dbBooks || []).map(db => ({
        id: db.id,
        title: db.title,
        subtitle: db.subtitle || undefined,
        authors: db.authors || [],
        publisher: db.publisher || '',
        isbn: db.isbn || '',
        publishedYear: db.published_year || new Date().getFullYear(),
        edition: db.edition || undefined,
        coverColor: db.cover_color || 'hsl(213 50% 25%)',
        coverUrl: db.cover_url || undefined,
        price: 0,
        description: db.description || '',
        specialty: db.specialty || 'Nursing',
        accessCount: db.access_count || 0,
        searchCount: db.search_count || 0,
        tags: db.tags || [],
        filePath: db.file_path || undefined,
        fileType: db.file_type || undefined,
        tableOfContents: [],
      }));

      setBooks(convertedBooks);
    } catch (err) {
      console.warn('DB fetch error:', err);
      setBooks([]);
    } finally {
      lastFetchedAt.current = Date.now();
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    refreshFromDB(true);
  }, [refreshFromDB, authLoading, user.isLoggedIn]);

  const addBook = useCallback((book: EpubBook) => {
    setBooks(prev => {
      if (prev.some(b => b.id === book.id)) return prev;
      return [book, ...prev];
    });
  }, []);

  const removeBook = useCallback((bookId: string) => {
    setBooks(prev => prev.filter(b => b.id !== bookId));
  }, []);

  const updateBook = useCallback((bookId: string, updates: Partial<EpubBook>) => {
    setBooks(prev => prev.map(b =>
      b.id === bookId ? { ...b, ...updates } : b
    ));
  }, []);

  const getBook = useCallback((bookId: string) => {
    return books.find(b => b.id === bookId);
  }, [books]);

  return (
    <BookContext.Provider value={{
      books,
      addBook,
      removeBook,
      updateBook,
      getBook,
      totalBooks: books.length,
      isLoading,
      refreshFromDB,
    }}>
      {children}
    </BookContext.Provider>
  );
}

export function useBooks() {
  const context = useContext(BookContext);
  if (!context) {
    throw new Error('useBooks must be used within a BookProvider');
  }
  return context;
}
