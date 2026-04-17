import { Library, BookOpen, ShieldCheck, Handshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

type FeatureAction =
  | { action: 'navigate'; path: string }
  | { action: 'toast'; message: string };

const features: Array<{
  icon: typeof Library;
  title: string;
  description: string;
  cta: string;
} & FeatureAction> = [
  {
    icon: Library,
    title: 'Browse Collections',
    description: "Buy subject based collections curated for your institution's needs.",
    cta: 'Explore Collections',
    action: 'navigate',
    path: '/collections',
  },
  {
    icon: BookOpen,
    title: 'Purchase Individual Titles',
    description: 'Select and purchase individual books from top medical publishers.',
    cta: 'Shop Titles',
    action: 'navigate',
    path: '/library',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance Packages',
    description: 'Access specialized bundles covering essential guidelines and compliance.',
    cta: 'View Packages',
    action: 'navigate',
    path: '/subscribe',
  },
  {
    icon: Handshake,
    title: 'White-Label Library Solutions',
    description: 'Offer a branded, custom library powered by Rittenhouse.',
    cta: 'Learn More',
    action: 'toast',
    message: 'White-Label Solutions are coming soon. Please contact us for more information.',
  },
];

export function LandingFeatures() {
  const navigate = useNavigate();

  const handleClick = (f: (typeof features)[number]) => {
    if (f.action === 'toast') {
      toast(f.message, {
        description: 'Reach out to enterprise@rittenhouse.com for early access.',
      });
    } else {
      navigate(f.path);
    }
  };

  return (
    <section className="relative z-10 pb-16 px-4 -mt-4 bg-gradient-to-b from-[#1a3a5c] to-[#f0f4f8] pt-8">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map(f => (
            <div
              key={f.title}
              className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-6 flex flex-col items-center text-center border border-blue-100"
            >
              <f.icon className="h-12 w-12 text-blue-700 mb-4" strokeWidth={1.5} />
              <h3 className="text-lg font-semibold text-blue-950 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-600 mb-6 min-h-[56px]">{f.description}</p>
              <Button
                onClick={() => handleClick(f)}
                className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold"
              >
                {f.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
