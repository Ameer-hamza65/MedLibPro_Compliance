import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingFeatures } from '@/components/landing/LandingFeatures';
import { LandingFooter } from '@/components/landing/LandingFooter';

export default function Index() {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <LandingHeader />
      <LandingHero />
      <LandingFeatures />
      <LandingFooter />
    </div>
  );
}
