import React from 'react';
import { Book, ShoppingCart, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EpubBook } from '@/data/mockEpubData';
import { getBookCover } from '@/assets/covers';
import { useCart } from '@/context/CartContext';
import { useUser } from '@/context/UserContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

interface CatalogCardProps {
  book: EpubBook;
  onView: (book: EpubBook) => void;
}

export function getBookPrice(bookId: string): number {
  const priceHash = bookId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Number(((priceHash % 160) + 45).toFixed(2));
}

export const CatalogCard = React.forwardRef<HTMLDivElement, CatalogCardProps>(
  function CatalogCard({ book, onView }, ref) {
    const coverImage = getBookCover(book.id) || book.coverUrl;
    const price = getBookPrice(book.id);
    const { addToCart, isInCart } = useCart();
    const { user } = useUser();
    const navigate = useNavigate();
    const { toast } = useToast();
    const inCart = isInCart(book.id);

    const handleAddToCart = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!user.isLoggedIn) {
        // Save intent, redirect to auth
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
        className="flex flex-col bg-white rounded border border-slate-200 overflow-hidden hover:shadow-md transition-shadow h-full cursor-pointer"
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={() => onView(book)}
      >
        {/* Cover */}
        <div
          className="w-full aspect-[3/4] relative overflow-hidden"
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
        </div>

        {/* Info */}
        <div className="p-2.5 flex flex-col flex-1">
          <h3 className="text-xs font-semibold text-slate-900 line-clamp-2 leading-tight">
            {book.title}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
            {book.authors.slice(0, 2).join(', ')}{book.authors.length > 2 ? ' et al.' : ''}
          </p>
          {book.publisher && (
            <p className="text-[11px] text-slate-400 line-clamp-1">{book.publisher}</p>
          )}
          <p className="text-sm font-bold text-red-600 mt-1.5">${price.toFixed(2)}</p>
          <div className="mt-auto pt-2">
            <Button
              onClick={handleAddToCart}
              size="sm"
              className={`w-full text-xs h-7 transition-all ${
                inCart
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-blue-700 hover:bg-blue-800 text-white'
              }`}
              disabled={inCart}
            >
              {inCart ? (
                <><Check className="h-3 w-3 mr-1" /> In Cart</>
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
