import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { EpubBook } from '@/data/mockEpubData';
import { supabase } from '@/integrations/supabase/client';
import { useUser } from '@/context/UserContext';

export interface CartItem {
  book: EpubBook;
  price: number;
  addedAt: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (book: EpubBook, price: number) => void;
  removeFromCart: (bookId: string) => void;
  clearCart: () => void;
  isInCart: (bookId: string) => boolean;
  totalPrice: number;
  itemCount: number;
  loading: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const LOCAL_CART_KEY = 'r2_cart_pending';

function loadLocalCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_CART_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveLocalCart(items: CartItem[]) {
  localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(items));
}

function clearLocalCart() {
  localStorage.removeItem(LOCAL_CART_KEY);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, session } = useUser();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Load cart from DB when user logs in
  useEffect(() => {
    if (!session?.user?.id) {
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const loadDbCart = async () => {
      const { data } = await supabase
        .from('cart_items')
        .select('*')
        .order('created_at', { ascending: true });

      if (cancelled) return;

      const dbItems: CartItem[] = (data || []).map((row: any) => ({
        book: row.book_data as EpubBook,
        price: Number(row.price),
        addedAt: new Date(row.created_at).getTime(),
      }));

      // Merge any local (pre-login) cart items
      const pendingItems = loadLocalCart();
      if (pendingItems.length > 0) {
        const existingBookIds = new Set(dbItems.map(i => i.book.id));
        const newItems = pendingItems.filter(i => !existingBookIds.has(i.book.id));

        for (const item of newItems) {
          await supabase.from('cart_items').insert({
            user_id: session.user.id,
            book_id: item.book.id,
            price: item.price,
            book_data: item.book as any,
          });
          dbItems.push(item);
        }
        clearLocalCart();
      }

      if (!cancelled) {
        setItems(dbItems);
        setLoading(false);
      }
    };

    loadDbCart();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const addToCart = useCallback((book: EpubBook, price: number) => {
    const newItem: CartItem = { book, price, addedAt: Date.now() };

    if (!session?.user?.id) {
      // Not logged in — save to localStorage for merging after login
      const pending = loadLocalCart();
      if (!pending.some(i => i.book.id === book.id)) {
        pending.push(newItem);
        saveLocalCart(pending);
      }
      setItems(prev => {
        if (prev.some(i => i.book.id === book.id)) return prev;
        return [...prev, newItem];
      });
      return;
    }

    setItems(prev => {
      if (prev.some(i => i.book.id === book.id)) return prev;
      return [...prev, newItem];
    });

    supabase.from('cart_items').insert({
      user_id: session.user.id,
      book_id: book.id,
      price,
      book_data: book as any,
    }).then();
  }, [session?.user?.id]);

  const removeFromCart = useCallback((bookId: string) => {
    setItems(prev => prev.filter(i => i.book.id !== bookId));

    if (session?.user?.id) {
      supabase.from('cart_items')
        .delete()
        .eq('user_id', session.user.id)
        .eq('book_id', bookId)
        .then();
    } else {
      const pending = loadLocalCart().filter(i => i.book.id !== bookId);
      saveLocalCart(pending);
    }
  }, [session?.user?.id]);

  const clearCart = useCallback(() => {
    setItems([]);
    clearLocalCart();

    if (session?.user?.id) {
      supabase.from('cart_items')
        .delete()
        .eq('user_id', session.user.id)
        .then();
    }
  }, [session?.user?.id]);

  const isInCart = useCallback((bookId: string) => {
    return items.some(i => i.book.id === bookId);
  }, [items]);

  const totalPrice = items.reduce((sum, i) => sum + i.price, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, clearCart, isInCart, totalPrice, itemCount: items.length, loading }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
