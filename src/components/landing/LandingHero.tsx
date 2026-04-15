import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/context/SearchContext';
import doctorBg from '@/assets/landing-doctor-bg.jpg';

export function LandingHero() {
  const [query, setQuery] = useState('');
  const { setSearch } = useSearch();
  const navigate = useNavigate();

  const handleSearch = () => {
    if (!query.trim()) return;
    setSearch({ query: query.trim(), mode: 'ai', hasSearched: true });
    navigate('/library');
  };

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background: doctor image positioned to the right */}
      <div className="absolute inset-0 z-0">
        <img
          src={doctorBg}
          alt=""
          className="absolute right-0 top-0 h-full w-[65%] object-cover object-top"
          width={1920}
          height={1080}
        />
        {/* Blue gradient overlays to blend left text area */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#1a3a5c] via-[#1a3a5c]/95 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1e4976]/90 via-[#1e4976]/60 to-transparent" />
        {/* Subtle top darkening for header readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f2a47]/60 via-transparent to-[#1a3a5c]/40" />
      </div>

      {/* Content — left aligned */}
      <div className="relative z-10 container mx-auto px-4 pt-24 pb-16">
        <div className="max-w-2xl">
          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl leading-tight mb-6">
            <span className="font-extrabold italic text-white">More Knowledge.</span>{' '}
            <span className="font-normal text-blue-200/80">Less Cost.</span>{' '}
            <span className="font-extrabold italic text-white">One Platform.</span>
          </h1>

          {/* Subheadline */}
          <div className="text-base sm:text-lg text-blue-100/80 max-w-xl mb-4 leading-relaxed space-y-1">
            <p>
              The most efficient way for institutions to access, search, and utilize clinical knowledge—
              across 150 publishers and 34 medical associations.
            </p>
            <p>Designed to maximize usage and minimize cost per user.</p>
          </div>

          <p className="text-base sm:text-lg font-semibold text-white/90 mb-10">
            Trusted by leading hospitals, medical schools, and government institutions
          </p>

          {/* AI Search Bar */}
          <div className="max-w-xl mb-3">
            <div className="flex items-center bg-white/95 backdrop-blur-sm rounded-full shadow-[0_0_30px_rgba(59,130,246,0.4)] border border-blue-300/50 overflow-hidden">
              <div className="pl-4 pr-2 text-blue-600">
                <Bot className="h-7 w-7" />
              </div>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Ask me anything..."
                className="flex-1 py-3.5 px-2 text-slate-700 placeholder-slate-400 bg-transparent outline-none text-base"
              />
              <Button
                onClick={handleSearch}
                className="m-1.5 rounded-full bg-blue-700 hover:bg-blue-800 text-white px-8 font-semibold text-base"
              >
                Search
              </Button>
            </div>
            <p className="text-blue-200 font-bold text-lg mt-4">
              AI-Powered Agent Search Bar
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
