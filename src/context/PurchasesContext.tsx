import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUser } from '@/context/UserContext';

interface PurchasesContextType {
  purchasedIds: Set<string>;
  hasPurchased: (id: string) => boolean;
  markPurchased: (ids: string[]) => void;
  loading: boolean;
}

const LOCAL_KEY = 'r2_purchased_ids';

const PurchasesContext = createContext<PurchasesContextType | undefined>(undefined);

function loadLocal(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveLocal(ids: string[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(ids));
  } catch {}
}

export function PurchasesProvider({ children }: { children: ReactNode }) {
  const { user, session } = useUser();
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(() => new Set(loadLocal()));
  const [loading, setLoading] = useState(false);

  // Hydrate from DB on login (merge with any local-only items)
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('individual_purchases')
      .select('book_id')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (cancelled) return;
        const dbIds = (data || []).map((r: any) => r.book_id);
        const merged = new Set<string>([...loadLocal(), ...dbIds]);
        setPurchasedIds(merged);
        saveLocal([...merged]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const markPurchased = useCallback((ids: string[]) => {
    setPurchasedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      saveLocal([...next]);
      return next;
    });
  }, []);

  const hasPurchased = useCallback((id: string) => purchasedIds.has(id), [purchasedIds]);

  return (
    <PurchasesContext.Provider value={{ purchasedIds, hasPurchased, markPurchased, loading }}>
      {children}
    </PurchasesContext.Provider>
  );
}

export function usePurchases() {
  const ctx = useContext(PurchasesContext);
  if (!ctx) throw new Error('usePurchases must be used within PurchasesProvider');
  return ctx;
}
