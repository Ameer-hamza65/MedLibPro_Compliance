import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, User, Building2, Shield, FolderOpen, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser } from '@/context/UserContext';
import { useEnterprise } from '@/context/EnterpriseContext';

const navLinks = [
  { label: 'Browse', path: '/library' },
  { label: 'Collections', path: '/collections' },
];

export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const { session } = useUser();
  const { currentEnterprise, currentUser, isEnterpriseMode, logoutEnterprise, can } = useEnterprise();

  const handleLogout = async () => {
    await logoutEnterprise();
  };

  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-[#0f2a47]/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <span className="text-3xl font-black text-white tracking-tight">R2</span>
          <span className="text-sm font-light text-white/80 tracking-[0.2em] uppercase hidden sm:inline">
            Intelligent Library
          </span>
        </Link>

        {/* Center nav – desktop */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map(link => (
            <Link
              key={link.label}
              to={link.path}
              className="text-sm font-medium text-white/80 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side: CTA or User Account */}
        <div className="hidden sm:flex items-center gap-3">
          {session && isEnterpriseMode && currentUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 text-white hover:bg-white/10">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-bold ring-2 ring-white/30"
                    style={{ backgroundColor: currentEnterprise?.logoColor || '#3b82f6' }}
                  >
                    {currentUser.name?.charAt(0) || 'U'}
                  </div>
                  <span className="font-medium text-white">{currentUser.name?.split(' ')[0]}</span>
                  <Badge className="bg-white/20 text-white border-white/30 text-xs">
                    {currentUser.role.replace('_', ' ')}
                  </Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-600" />
                    <span>{currentEnterprise?.name}</span>
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
              className="text-white hover:bg-white/10 gap-2"
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
          className="md:hidden p-2 text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-slate-900/95 backdrop-blur-md border-t border-white/10">
          <nav className="flex flex-col p-4 gap-3">
            {navLinks.map(link => (
              <Link
                key={link.label}
                to={link.path}
                onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-white/80 hover:text-white py-2"
              >
                {link.label}
              </Link>
            ))}
            {session ? (
              <Button
                onClick={() => { handleLogout(); setMobileOpen(false); }}
                variant="ghost"
                className="text-white hover:bg-white/10 justify-start gap-2 mt-2"
              >
                <LogOut className="h-4 w-4" />Sign Out
              </Button>
            ) : (
              <Button
                onClick={() => { navigate('/subscribe'); setMobileOpen(false); }}
                className="bg-lime-500 hover:bg-lime-600 text-white font-semibold rounded-full mt-2"
              >
                Free Institutional Trial
              </Button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
