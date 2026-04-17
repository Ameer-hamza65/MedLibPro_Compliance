import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Trash2, Book, ArrowRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCart } from '@/context/CartContext';
import { getBookCover } from '@/assets/covers';
import { ReactNode } from 'react';

interface CartDrawerProps {
  trigger: ReactNode;
}

export function CartDrawer({ trigger }: CartDrawerProps) {
  const navigate = useNavigate();
  const { items, removeFromCart, totalPrice, itemCount } = useCart();
  const tax = totalPrice * 0.08;
  const grandTotal = totalPrice + tax;

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2 text-slate-900">
            <ShoppingCart className="h-5 w-5 text-blue-700" />
            Your Cart
            <span className="text-sm font-normal text-slate-500">
              ({itemCount} {itemCount === 1 ? 'item' : 'items'})
            </span>
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <ShoppingCart className="h-12 w-12 text-slate-200 mb-3" />
            <p className="text-sm font-medium text-slate-700 mb-1">Your cart is empty</p>
            <p className="text-xs text-slate-500 mb-4">Browse the catalog to add titles</p>
            <Button onClick={() => navigate('/library')} className="bg-blue-600 hover:bg-blue-700 text-white">
              Browse Library
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-3">
                {items.map(item => {
                  const cover = getBookCover(item.book.id) || item.book.coverUrl;
                  return (
                    <div key={item.book.id} className="flex gap-3 p-3 rounded-md border border-slate-200">
                      <div
                        className="w-12 h-16 rounded overflow-hidden flex-shrink-0"
                        style={{ backgroundColor: !cover ? (item.book.coverColor || '#1e3a5f') : undefined }}
                      >
                        {cover ? (
                          <img src={cover} alt={item.book.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Book className="h-5 w-5 text-white/40" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 line-clamp-2 leading-tight">
                          {item.book.title}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                          {item.book.authors.slice(0, 2).join(', ')}
                        </p>
                        <p className="text-sm font-bold text-red-600 mt-1">${item.price.toFixed(2)}</p>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.book.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1 self-start"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <SheetFooter className="border-t px-6 py-4 flex-col gap-3 sm:flex-col">
              <div className="w-full space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>${totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax (8%)</span>
                  <span>${tax.toFixed(2)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span className="text-blue-700">${grandTotal.toFixed(2)}</span>
                </div>
              </div>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => navigate('/cart')}
              >
                Proceed to Checkout
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
