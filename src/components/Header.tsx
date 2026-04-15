import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Book, Search, LogOut, Building2, Shield, FileText, FolderOpen, LogIn, Upload, Menu, X, User, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useEnterprise } from '@/context/EnterpriseContext';
import { useCart } from '@/context/CartContext';
import { useUser } from '@/context/UserContext';

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { 
    currentEnterprise, 
    currentUser, 
    isEnterpriseMode, 
    isPlatformAdmin,
    logoutEnterprise,
    can,
  } = useEnterprise();
  const { session } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { itemCount } = useCart();

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = async () => {
    await logoutEnterprise();
  };

  const isStaff = isEnterpriseMode && currentUser?.role === 'staff';

  const navLinks = [
    { label: 'Browse', path: '/library', show: !isStaff },
    { label: 'Collections', path: '/collections', show: true },
  ].filter(l => l.show);

  const enterpriseLinks = isEnterpriseMode ? [
    { label: 'Dashboard', path: '/enterprise', show: true },
    { label: 'Audit Logs', path: '/audit-logs', show: can('audit.view') },
  ].filter(l => l.show) : [];

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white focus:rounded-md focus:outline-none">
        Skip to main content
      </a>
      <header
        role="banner"
        className="sticky top-0 z-50 w-full bg-slate-800 shadow-md"
      >
        <div className="container flex h-16 items-center justify-between px-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl font-black text-white tracking-tight">R2</span>
            <span className="text-xs font-light text-white/70 tracking-[0.2em] uppercase hidden sm:inline">
              Intelligent Library
            </span>
          </Link>

          {/* Center nav – desktop */}
          <nav className="hidden lg:flex items-center gap-6" aria-label="Main navigation">
            {navLinks.map(link => (
              <Link
                key={link.label}
                to={link.path}
                className={`text-sm font-medium transition-colors ${
                  isActive(link.path) 
                    ? 'text-white border-b-2 border-blue-400 pb-0.5' 
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
            {enterpriseLinks.map(link => (
              <Link
                key={link.label}
                to={link.path}
                className={`text-sm font-medium transition-colors ${
                  isActive(link.path) 
                    ? 'text-white border-b-2 border-blue-400 pb-0.5' 
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Cart icon */}
            <Link to="/cart" className="relative p-2 text-white/70 hover:text-white transition-colors">
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {itemCount}
                </span>
              )}
            </Link>
            {/* Admin links */}
            {session && isPlatformAdmin && (
              <div className="hidden md:flex items-center gap-1">
                <Link to="/admin/dashboard">
                  <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10 gap-1.5">
                    <Shield className="h-4 w-4" />
                    <span className="hidden lg:inline">Admin</span>
                  </Button>
                </Link>
                <Link to="/admin/upload">
                  <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10 gap-1.5">
                    <Upload className="h-4 w-4" />
                    <span className="hidden lg:inline">Upload</span>
                  </Button>
                </Link>
              </div>
            )}

            {/* User account / CTA */}
            <div className="hidden sm:flex items-center">
              {session && isEnterpriseMode && currentUser && currentEnterprise ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 text-white hover:bg-white/10">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-bold ring-2 ring-white/30"
                        style={{ backgroundColor: currentEnterprise.logoColor || '#3b82f6' }}
                      >
                        {currentEnterprise.name.charAt(0)}
                      </div>
                      <span className="hidden md:inline font-medium text-white">{currentUser.name?.split(' ')[0]}</span>
                      <Badge className="hidden lg:inline-flex bg-white/20 text-white border-white/30 text-xs">
                        {currentUser.role.replace('_', ' ')}
                      </Badge>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-600" />
                        <span>{currentEnterprise.name}</span>
                      </div>
                    </DropdownMenuLabel>
                    <div className="px-2 py-1.5">
                      <p className="text-sm font-medium">{currentUser.name}</p>
                      <p className="text-xs text-muted-foreground">{currentUser.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/enterprise" className="cursor-pointer">
                        <Shield className="mr-2 h-4 w-4" />Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/collections" className="cursor-pointer">
                        <FolderOpen className="mr-2 h-4 w-4" />Collections
                      </Link>
                    </DropdownMenuItem>
                    {can('audit.view') && (
                      <DropdownMenuItem asChild>
                        <Link to="/audit-logs" className="cursor-pointer">
                          <FileText className="mr-2 h-4 w-4" />Audit Logs
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive">
                      <LogOut className="mr-2 h-4 w-4" />Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : session ? (
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
                >
                  <User className="h-4 w-4" />
                  Sign Out
                </Button>
              ) : (
                <Button
                  onClick={() => navigate('/subscribe')}
                  className="bg-lime-500 hover:bg-lime-600 text-white font-semibold shadow-md rounded-full px-6"
                >
                  Free Institutional Trial
                </Button>
              )}
            </div>

            {/* Mobile toggle */}
            <button
              className="lg:hidden p-2 text-white"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden bg-slate-800 border-t border-white/10">
            <nav className="flex flex-col p-4 gap-2" aria-label="Mobile navigation">
              {navLinks.map(link => (
                <Link
                  key={link.label}
                  to={link.path}
                  onClick={() => setMobileOpen(false)}
                  className={`text-sm font-medium py-2 px-3 rounded ${
                    isActive(link.path) ? 'text-white bg-white/10' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              {enterpriseLinks.map(link => (
                <Link
                  key={link.label}
                  to={link.path}
                  onClick={() => setMobileOpen(false)}
                  className={`text-sm font-medium py-2 px-3 rounded ${
                    isActive(link.path) ? 'text-white bg-white/10' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <div className="border-t border-white/10 my-2" />
              {session ? (
                <>
                  {isPlatformAdmin && (
                    <Link to="/admin/upload" onClick={() => setMobileOpen(false)} className="text-sm text-white/70 hover:text-white py-2 px-3">
                      Upload
                    </Link>
                  )}
                  <button onClick={() => { handleLogout(); setMobileOpen(false); }} className="text-sm text-red-400 hover:text-red-300 py-2 px-3 text-left">
                    Sign Out
                  </button>
                </>
              ) : (
                <Link to="/auth" onClick={() => setMobileOpen(false)} className="text-sm text-white/70 hover:text-white py-2 px-3">
                  Sign In
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>
    </>
  );
}
