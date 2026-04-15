import { Link } from 'react-router-dom';
import { Shield, FileText, Book, Building2, Database } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-8 mt-auto" role="contentinfo">
      <div className="container px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl font-black text-blue-800 tracking-tight">R2</span>
              <span className="text-xs font-light text-slate-500 tracking-[0.15em] uppercase">
                Intelligent Library
              </span>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              AI-powered compliance collections for hospitals and surgery centers. Institutional SaaS licensing with enterprise-grade security.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-3 text-sm uppercase tracking-wider">Platform</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/library" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <Book className="h-3.5 w-3.5" /> Title Catalog
                </Link>
              </li>
              <li>
                <Link to="/collections" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Compliance Collections
                </Link>
              </li>
              <li>
                <Link to="/counter-reports" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> COUNTER 5.1 Reports
                </Link>
              </li>
              <li>
                <Link to="/admin/repository" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5" /> Repository Architecture
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-3 text-sm uppercase tracking-wider">Compliance</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/accessibility" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" /> VPAT / Accessibility
                </Link>
              </li>
              <li>
                <Link to="/counter-reports" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> COUNTER 5.1 Reports
                </Link>
              </li>
              <li>
                <Link to="/audit-logs" className="text-sm text-slate-500 hover:text-blue-700 transition-colors flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Audit Logs
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-slate-200 flex items-center justify-center gap-2">
          <span className="text-xs text-slate-400">powered by</span>
          <Shield className="h-4 w-4 text-blue-700" />
          <span className="text-sm font-bold text-blue-900">Rittenhouse Digital</span>
          <span className="text-xs text-slate-400 ml-4">
            © {new Date().getFullYear()} All rights reserved. WCAG 2.1 AA Compliant.
          </span>
        </div>
      </div>
    </footer>
  );
}
