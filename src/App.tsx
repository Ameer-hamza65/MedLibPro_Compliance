import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { UserProvider } from "@/context/UserContext";
import { SearchProvider } from "@/context/SearchContext";
import ScrollToTop from "@/components/ScrollToTop";
import { BookProvider } from "@/context/BookContext";
import { EnterpriseProvider } from "@/context/EnterpriseContext";
import { CartProvider } from "@/context/CartContext";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import Index from "./pages/Index";
import Library from "./pages/Library";
import Reader from "./pages/Reader";
import AdminUpload from "./pages/AdminUpload";
import BookDetail from "./pages/BookDetail";
import EnterpriseDashboard from "./pages/EnterpriseDashboard";
import ComplianceCollections from "./pages/ComplianceCollections";
import CollectionDetail from "./pages/CollectionDetail";
import AuditLogs from "./pages/AuditLogs";
import CounterReporting from "./pages/CounterReporting";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Accessibility from "./pages/Accessibility";
import RepositoryOverview from "./pages/RepositoryOverview";
import InstitutionalPricing from "./pages/InstitutionalPricing";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import Cart from "./pages/Cart";

import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  },
});

function AppLayout() {
  const location = useLocation();
  const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === 'true';
  const isLanding = location.pathname === '/';

  return (
    <>
      <ScrollToTop />
      <div className="min-h-screen flex flex-col">
        {!isEmbedded && !isLanding && <Header />}
        <main className="flex-1" id="main-content">
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/library" element={<Library />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/reader" element={<Reader />} />
            <Route path="/book/:id" element={<BookDetail />} />
            <Route path="/admin/upload" element={<RoleProtectedRoute requirePlatformAdmin><AdminUpload /></RoleProtectedRoute>} />
            <Route path="/admin/dashboard" element={<RoleProtectedRoute requirePlatformAdmin><SuperAdminDashboard /></RoleProtectedRoute>} />
            <Route path="/admin/repository" element={<RoleProtectedRoute requirePlatformAdmin><RepositoryOverview /></RoleProtectedRoute>} />

            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/enterprise" element={<ProtectedRoute><EnterpriseDashboard /></ProtectedRoute>} />
            <Route path="/collections" element={<ProtectedRoute><ComplianceCollections /></ProtectedRoute>} />
            <Route path="/collections/:collectionId" element={<ProtectedRoute><CollectionDetail /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<RoleProtectedRoute allowedRoles={['admin', 'compliance_officer']}><AuditLogs /></RoleProtectedRoute>} />
            <Route path="/counter-reports" element={<RoleProtectedRoute allowedRoles={['admin', 'compliance_officer']}><CounterReporting /></RoleProtectedRoute>} />

            <Route path="/accessibility" element={<Accessibility />} />
            <Route path="/subscribe" element={<InstitutionalPricing />} />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        {!isEmbedded && !isLanding && <Footer />}
      </div>
    </>
  );
}

const App = () => {
  return (
  <QueryClientProvider client={queryClient}>
    <UserProvider>
      <BookProvider>
        <EnterpriseProvider>
          <CartProvider>
          <SearchProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppLayout />
            </BrowserRouter>
          </TooltipProvider>
          </SearchProvider>
          </CartProvider>
        </EnterpriseProvider>
      </BookProvider>
    </UserProvider>
  </QueryClientProvider>
  );
};

export default App;
