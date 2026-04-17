import React from 'react';
import { Book, ShoppingCart, Check, Layers, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EpubBook } from '@/data/mockEpubData';
import { getBookCover } from '@/assets/covers';
import { useCart } from '@/context/CartContext';
import { useUser } from '@/context/UserContext';
import { usePurchases } from '@/context/PurchasesContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type CatalogCardVariant = 'book' | 'collection';

interface CatalogCardProps {
  book: EpubBook;
  onView: (book: EpubBook) => void;
  variant?: CatalogCardVariant;
  /** Optional annual price range for compliance collections, e.g. [5000, 10000] */
  annualPriceRange?: [number, number];
}

export function getBookPrice(bookId: string): number {
  const priceHash = bookId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Number(((priceHash % 160) + 45).toFixed(2));
}

/** Frontend-only heuristic to flag a "Curated Collection" without changing the EpubBook type. */
export function isCuratedCollection(book: EpubBook): boolean {
  const tags = (book.tags || []).map(t => t.toLowerCase());
  if (tags.some(t => t.includes('collection') || t.includes('compliance') || t.includes('bundle'))) {
    return true;
  }
  const specialty = (book.specialty || '').toLowerCase();
  return /compliance|guideline|bundle|collection/.test(specialty);
}

/** Deterministic placeholder annual range derived from the book id, in $1k steps. */
export function getAnnualPriceRange(bookId: string): [number, number] {
  const hash = bookId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const lower = 3000 + (hash % 5) * 1000; // 3k–7k
  const upper = lower + 4000 + (hash % 4) * 1000; // +4k–7k
  return [lower, upper];
}

export const CatalogCard = React.forwardRef<HTMLDivElement, CatalogCardProps>(
  function CatalogCard({ book, onView, variant = 'book', annualPriceRange }, ref) {
    const coverImage = getBookCover(book.id) || book.coverUrl;
    const price = getBookPrice(book.id);
    const { addToCart, isInCart } = useCart();
    const { user } = useUser();
    const { hasPurchased } = usePurchases();
    const navigate = useNavigate();
    const { toast } = useToast();
    const inCart = isInCart(book.id);
    const owned = hasPurchased(book.id);
    const isCollection = variant === 'collection';
    const range = annualPriceRange || getAnnualPriceRange(book.id);
    const formatUsd = (n: number) => `$${n.toLocaleString()}`;

    const handleAddToCart = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (owned) {
        navigate(`/reader?book=${book.id}&chapter=__book-info__`);
        return;
      }
      if (!user.isLoggedIn) {
        addToCart(book, price);
        navigate('/auth?redirect=/cart');
        return;
      }
      addToCart(book, price);
      toast({ title: 'Added to cart', description: book.title });
    };

    return (
      <motion.div
        ref={ref}
        className={cn(
          'flex flex-col rounded overflow-hidden hover:shadow-md transition-shadow h-full cursor-pointer',
          isCollection
            ? 'bg-blue-50/50 border-2 border-blue-300 shadow-sm'
            : 'bg-white border border-slate-200',
        )}
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={() => onView(book)}
      >
        {/* Curated Collection badge — pinned to the very top */}
        {isCollection && (
          <div className="bg-blue-700 text-white px-2.5 py-1 flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            <Badge className="bg-white text-blue-800 hover:bg-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0">
              Curated Collection
            </Badge>
          </div>
        )}

        {/* Cover */}
        <div
          className={cn(
            'w-full relative overflow-hidden',
            isCollection ? 'aspect-[4/3]' : 'aspect-[3/4]',
          )}
          style={{ background: !coverImage ? `linear-gradient(135deg, ${book.coverColor} 0%, ${book.coverColor}dd 100%)` : undefined }}
        >
          {coverImage ? (
            <img
              src={coverImage}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: book.coverColor || '#1e3a5f' }}>
              <Book className="h-10 w-10 text-white/30" />
            </div>
          )}
          {isCollection && (
            <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 via-transparent to-transparent" />
          )}
        </div>

        {/* Info */}
        <div className={cn('flex flex-col flex-1', isCollection ? 'p-3' : 'p-2.5')}>
          <h3 className={cn(
            'font-semibold text-slate-900 line-clamp-2 leading-tight',
            isCollection ? 'text-sm' : 'text-xs',
          )}>
            {book.title}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
            {book.authors.slice(0, 2).join(', ')}{book.authors.length > 2 ? ' et al.' : ''}
          </p>
          {book.publisher && (
            <p className="text-[11px] text-slate-400 line-clamp-1">{book.publisher}</p>
          )}

          {/* Pricing — different for collections vs. individual books */}
          {isCollection ? (
            <div className="mt-2 rounded bg-white/70 border border-blue-200 px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                Proposed Annual Charge
              </p>
              <p className="text-sm font-bold text-blue-900">
                {formatUsd(range[0])} – {formatUsd(range[1])}
              </p>
            </div>
          ) : owned ? (
            <p className="text-sm font-bold text-green-700 mt-1.5 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Purchased
            </p>
          ) : (
            <p className="text-sm font-bold text-red-600 mt-1.5">${price.toFixed(2)}</p>
          )}

          <div className="mt-auto pt-2">
            <Button
              onClick={handleAddToCart}
              size="sm"
              className={cn(
                'w-full text-xs h-7 transition-all',
                owned
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : inCart
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : isCollection
                      ? 'bg-blue-800 hover:bg-blue-900 text-white'
                      : 'bg-blue-700 hover:bg-blue-800 text-white',
              )}
              disabled={!owned && inCart}
            >
              {owned ? (
                <><BookOpen className="h-3 w-3 mr-1" /> Read Now</>
              ) : inCart ? (
                <><Check className="h-3 w-3 mr-1" /> In Cart</>
              ) : isCollection ? (
                <><Layers className="h-3 w-3 mr-1" /> Request Collection</>
              ) : (
                <><ShoppingCart className="h-3 w-3 mr-1" /> Add to Cart</>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }
);
