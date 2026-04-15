import { Shield } from 'lucide-react';

export function LandingFooter() {
  return (
    <footer className="relative z-10 py-6 text-center bg-white/60 backdrop-blur-sm">
      <div className="flex items-center justify-center gap-2 text-slate-600 text-sm">
        <span>powered by</span>
        <Shield className="h-5 w-5 text-blue-700" />
        <span className="font-bold text-blue-900 text-base">Rittenhouse Digital</span>
      </div>
    </footer>
  );
}
