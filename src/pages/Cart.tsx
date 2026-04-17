import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Trash2, CreditCard, CheckCircle2, ArrowLeft, Lock, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCart } from '@/context/CartContext';
import { useUser } from '@/context/UserContext';
import { usePurchases } from '@/context/PurchasesContext';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { getBookCover } from '@/assets/covers';
import { Book } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type CheckoutStep = 'cart' | 'payment' | 'complete';

export default function Cart() {
  const navigate = useNavigate();
  const { items, removeFromCart, clearCart, totalPrice } = useCart();
  const { user } = useUser();
  const { markPurchased } = usePurchases();
  const { toast } = useToast();
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [processing, setProcessing] = useState(false);

  // Institutional billing state
  const [institutionName, setInstitutionName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState(user.email || '');

  // Payment form state
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  const handleProceedToPayment = () => {
    if (!user.isLoggedIn) {
      navigate('/auth?redirect=/cart');
      return;
    }
    setStep('payment');
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!institutionName || !billingName || !billingEmail || !cardName || !cardNumber || !expiry || !cvv) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    setProcessing(true);

    // Capture purchased ids BEFORE clearing the cart
    const purchasedIds = items.map(i => i.book.id);

    // Simulate payment processing delay
    await new Promise(r => setTimeout(r, 1500));

    // Record each purchase in the database (best-effort)
    if (user.id) {
      for (const item of items) {
        await supabase.from('individual_purchases').insert({
          user_id: user.id,
          book_id: item.book.id,
          price_paid: item.price,
        });
      }
    }

    // Instant access provisioning — update global state so Read Now buttons appear
    markPurchased(purchasedIds);

    sonnerToast.success('Purchase successful. Your content is now available.');

    setProcessing(false);
    setStep('complete');
    clearCart();
  };

  const tax = totalPrice * 0.08;
  const grandTotal = totalPrice + tax;

  return (
    <div className="min-h-screen bg-white">
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(['cart', 'payment', 'complete'] as CheckoutStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <motion.div
                className={`flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold transition-colors ${
                  step === s ? 'bg-blue-700 text-white' :
                  (['cart', 'payment', 'complete'].indexOf(step) > i) ? 'bg-green-500 text-white' :
                  'bg-slate-200 text-slate-500'
                }`}
                animate={{ scale: step === s ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                {(['cart', 'payment', 'complete'].indexOf(step) > i) ? '✓' : i + 1}
              </motion.div>
              <span className={`text-xs font-medium hidden sm:inline ${step === s ? 'text-blue-700' : 'text-slate-400'}`}>
                {s === 'cart' ? 'Cart' : s === 'payment' ? 'Payment' : 'Complete'}
              </span>
              {i < 2 && <div className="w-8 sm:w-16 h-px bg-slate-300" />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* CART STEP */}
          {step === 'cart' && (
            <motion.div
              key="cart"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <ShoppingCart className="h-6 w-6 text-blue-700" />
                <h1 className="text-2xl font-bold text-slate-900">Your Cart</h1>
                <span className="text-sm text-slate-500">({items.length} {items.length === 1 ? 'item' : 'items'})</span>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-16">
                  <ShoppingCart className="h-16 w-16 text-slate-200 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-slate-700 mb-2">Your cart is empty</h2>
                  <p className="text-slate-500 mb-6">Browse our catalog to find the titles you need</p>
                  <Button onClick={() => navigate('/library')} className="bg-blue-700 hover:bg-blue-800 text-white">
                    Shop Titles
                  </Button>
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-6">
                  {/* Items list */}
                  <div className="md:col-span-2 space-y-3">
                    {items.map((item, idx) => {
                      const cover = getBookCover(item.book.id) || item.book.coverUrl;
                      return (
                        <motion.div
                          key={item.book.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="flex gap-4 p-4 border border-slate-200 rounded-lg hover:shadow-sm transition-shadow"
                        >
                          <div className="w-16 h-20 rounded overflow-hidden flex-shrink-0" style={{ backgroundColor: !cover ? (item.book.coverColor || '#1e3a5f') : undefined }}>
                            {cover ? (
                              <img src={cover} alt={item.book.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Book className="h-6 w-6 text-white/30" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">{item.book.title}</h3>
                            <p className="text-xs text-slate-500 mt-0.5">{item.book.authors.slice(0, 2).join(', ')}</p>
                            {item.book.publisher && <p className="text-xs text-slate-400">{item.book.publisher}</p>}
                          </div>
                          <div className="flex flex-col items-end justify-between">
                            <span className="text-sm font-bold text-red-600">${item.price.toFixed(2)}</span>
                            <button
                              onClick={() => removeFromCart(item.book.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors p-1"
                              aria-label="Remove from cart"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Order summary */}
                  <Card className="h-fit sticky top-24">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Order Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Subtotal</span>
                        <span className="font-medium">${totalPrice.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tax (8%)</span>
                        <span className="font-medium">${tax.toFixed(2)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-base font-bold">
                        <span>Total</span>
                        <span className="text-blue-700">${grandTotal.toFixed(2)}</span>
                      </div>
                      <Button
                        className="w-full bg-blue-700 hover:bg-blue-800 text-white mt-2"
                        onClick={handleProceedToPayment}
                      >
                        <CreditCard className="h-4 w-4 mr-2" />
                        Proceed to Checkout
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => navigate('/library')}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Continue Shopping
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </motion.div>
          )}

          {/* PAYMENT STEP */}
          {step === 'payment' && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="max-w-lg mx-auto"
            >
              <div className="flex items-center gap-3 mb-6">
                <Lock className="h-5 w-5 text-blue-700" />
                <h1 className="text-2xl font-bold text-slate-900">Institutional Checkout</h1>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <form onSubmit={handleSubmitPayment} className="space-y-5">
                    {/* Institutional billing block */}
                    <div className="space-y-3">
                      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                        Institutional Details
                      </h2>
                      <div className="space-y-2">
                        <Label htmlFor="institutionName">Institution Name *</Label>
                        <Input
                          id="institutionName"
                          placeholder="e.g. Sarasota Memorial Hospital"
                          value={institutionName}
                          onChange={e => setInstitutionName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="poNumber">Purchase Order (PO) Number</Label>
                        <Input
                          id="poNumber"
                          placeholder="PO-2026-00123 (optional)"
                          value={poNumber}
                          onChange={e => setPoNumber(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="billingName">Billing Contact *</Label>
                          <Input
                            id="billingName"
                            placeholder="Jane Doe"
                            value={billingName}
                            onChange={e => setBillingName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billingEmail">Billing Email *</Label>
                          <Input
                            id="billingEmail"
                            type="email"
                            placeholder="billing@hospital.org"
                            value={billingEmail}
                            onChange={e => setBillingEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Payment block */}
                    <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                      Payment
                    </h2>
                    <div className="space-y-2">
                      <Label htmlFor="cardName">Name on Card</Label>
                      <Input
                        id="cardName"
                        placeholder="John Smith"
                        value={cardName}
                        onChange={e => setCardName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cardNumber">Card Number</Label>
                      <div className="relative">
                        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          id="cardNumber"
                          placeholder="4242 4242 4242 4242"
                          value={cardNumber}
                          onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                          className="pl-10"
                          maxLength={19}
                          required
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="expiry">Expiry</Label>
                        <Input
                          id="expiry"
                          placeholder="MM/YY"
                          value={expiry}
                          onChange={e => setExpiry(formatExpiry(e.target.value))}
                          maxLength={5}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cvv">CVV</Label>
                        <Input
                          id="cvv"
                          placeholder="123"
                          type="password"
                          value={cvv}
                          onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          maxLength={4}
                          required
                        />
                      </div>
                    </div>

                    <Separator className="my-4" />

                    <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">{items.length} items</span>
                        <span>${totalPrice.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tax</span>
                        <span>${tax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-blue-700">
                        <span>Total</span>
                        <span>${grandTotal.toFixed(2)}</span>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-blue-700 hover:bg-blue-800 text-white h-12 text-base"
                      disabled={processing}
                    >
                      {processing ? (
                        <motion.div
                          className="flex items-center gap-2"
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        >
                          <Package className="h-5 w-5 animate-spin" />
                          Processing...
                        </motion.div>
                      ) : (
                        <>
                          <Lock className="h-4 w-4 mr-2" />
                          Confirm Purchase — ${grandTotal.toFixed(2)}
                        </>
                      )}
                    </Button>

                    <button
                      type="button"
                      onClick={() => setStep('cart')}
                      className="w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors mt-2"
                    >
                      ← Back to Cart
                    </button>
                  </form>
                </CardContent>
              </Card>

              <p className="text-xs text-slate-400 text-center mt-4 flex items-center justify-center gap-1">
                <Lock className="h-3 w-3" /> Demo mode — no real charges will be made
              </p>
            </motion.div>
          )}

          {/* COMPLETE STEP */}
          {step === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, type: 'spring' }}
              className="text-center py-16 max-w-md mx-auto"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              >
                <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto mb-6" />
              </motion.div>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">Purchase Complete!</h1>
              <p className="text-slate-600 mb-2">Thank you for your order.</p>
              <p className="text-sm text-slate-500 mb-8">
                A confirmation email has been sent to <span className="font-medium">{user.email}</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate('/library')} className="bg-blue-700 hover:bg-blue-800 text-white">
                  Continue Browsing
                </Button>
                <Button variant="outline" onClick={() => navigate('/enterprise')}>
                  Go to Dashboard
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
