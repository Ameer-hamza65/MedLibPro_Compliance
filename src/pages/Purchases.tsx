import { Link } from 'react-router-dom';
import { BookOpen, ShoppingBag, Sparkles, Clock, Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useBooks } from '@/context/BookContext';
import { usePurchases } from '@/context/PurchasesContext';
import { useUser } from '@/context/UserContext';
import { getBookCover } from '@/assets/covers';
import { motion } from 'framer-motion';
import { useState, useMemo } from 'react';

export default function Purchases() {
  const { books, isLoading } = useBooks();
  const { purchasedIds, loading } = usePurchases();
  const { session } = useUser();
  const [query, setQuery] = useState('');

  const purchasedBooks = useMemo(
    () => books.filter(b => purchasedIds.has(b.id)),
    [books, purchasedIds],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return purchasedBooks;
    const q = query.toLowerCase();
    return purchasedBooks.filter(
      b =>
        b.title.toLowerCase().includes(q) ||
        b.authors?.some(a => a.toLowerCase().includes(q)) ||
        b.publisher?.toLowerCase().includes(q),
    );
  }, [purchasedBooks, query]);

  if (!session) {
    return (
      <div className="container max-w-3xl py-16 text-center">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">My Library</h1>
        <p className="text-slate-600 mb-6">Sign in to view your purchased titles.</p>
        <Link to="/auth">
          <Button className="bg-blue-600 hover:bg-blue-700">Sign In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Hero band */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0f2a47] via-[#1e4976] to-[#1a3a5c] text-white">
        <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div className="container max-w-6xl px-4 py-12 relative">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <Badge className="bg-lime-500/90 hover:bg-lime-500 text-slate-900 font-semibold mb-3">
                <Sparkles className="h-3 w-3 mr-1" /> Your Personal Shelf
              </Badge>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
                My Library
              </h1>
              <p className="text-blue-100/90 mt-2 text-lg">
                {purchasedBooks.length === 0
                  ? 'Your purchased titles will appear here.'
                  : `${purchasedBooks.length} ${purchasedBooks.length === 1 ? 'title is' : 'titles are'} ready for you to read.`}
              </p>
            </div>

            {purchasedBooks.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                  <p className="text-xs uppercase tracking-wider text-blue-200/80">Total Titles</p>
                  <p className="text-2xl font-bold">{purchasedBooks.length}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20 hidden sm:block">
                  <p className="text-xs uppercase tracking-wider text-blue-200/80">Available</p>
                  <p className="text-2xl font-bold flex items-center gap-1">
                    <Clock className="h-5 w-5" /> 24/7
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Search bar */}
          {purchasedBooks.length > 0 && (
            <div className="mt-8 max-w-xl">
              <div className="flex items-center bg-white rounded-full shadow-lg overflow-hidden">
                <Search className="h-5 w-5 ml-4 text-slate-400 flex-shrink-0" />
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your library..."
                  className="border-0 focus-visible:ring-0 text-slate-700 bg-transparent"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="container max-w-6xl px-4 py-10">
        {isLoading || loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[3/4] bg-slate-200 rounded-xl mb-3" />
                <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : purchasedBooks.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-2 bg-white/60 backdrop-blur">
            <div className="mx-auto w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mb-5">
              <ShoppingBag className="h-10 w-10 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Your library is empty</h2>
            <p className="text-slate-600 mb-6 max-w-md mx-auto">
              Browse our catalog of clinical titles from 150+ publishers and start building your shelf.
            </p>
            <Link to="/library">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                Browse Catalog <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </Card>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            No titles match "<span className="font-medium text-slate-700">{query}</span>".
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {filtered.map((book, idx) => {
              const cover = book.coverUrl || getBookCover(book.id);
              return (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.4 }}
                >
                  <Card className="group overflow-hidden flex flex-col h-full border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all duration-300 bg-white">
                    {/* Cover */}
                    <Link
                      to={`/reader?book=${book.id}&chapter=__book-info__`}
                      className="relative block aspect-[3/4] overflow-hidden"
                    >
                      <div
                        className="absolute inset-0 flex items-center justify-center text-white p-4 text-center"
                        style={{
                          background: cover ? undefined : (book.coverColor || 'hsl(213 50% 25%)'),
                        }}
                      >
                        {cover ? (
                          <img
                            src={cover}
                            alt={book.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <span className="text-sm font-semibold leading-tight line-clamp-6">
                            {book.title}
                          </span>
                        )}
                      </div>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                        <Badge className="bg-white text-slate-900 hover:bg-white shadow-lg">
                          <BookOpen className="h-3 w-3 mr-1" /> Open Reader
                        </Badge>
                      </div>
                      {/* Owned ribbon */}
                      <div className="absolute top-2 right-2">
                        <Badge className="bg-green-600 hover:bg-green-600 text-white shadow-md text-[10px] uppercase tracking-wide">
                          Owned
                        </Badge>
                      </div>
                    </Link>

                    {/* Info */}
                    <div className="p-4 flex flex-col flex-1">
                      <h3 className="font-bold text-slate-900 line-clamp-2 mb-1 leading-snug group-hover:text-blue-700 transition-colors">
                        {book.title}
                      </h3>
                      <p className="text-xs text-slate-500 line-clamp-1 mb-1">
                        {book.authors?.join(', ')}
                      </p>
                      {book.publisher && (
                        <p className="text-[11px] text-slate-400 line-clamp-1 mb-3">
                          {book.publisher}
                        </p>
                      )}
                      <div className="mt-auto flex gap-2">
                        <Link
                          to={`/reader?book=${book.id}&chapter=__book-info__`}
                          className="flex-1"
                        >
                          <Button className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-sm">
                            <BookOpen className="h-4 w-4 mr-1.5" /> Read
                          </Button>
                        </Link>
                        <Link to={`/book/${book.id}`}>
                          <Button variant="outline" size="icon" title="View details">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
