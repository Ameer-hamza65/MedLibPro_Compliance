import { useState } from 'react';
import { Library, BookOpen, ShieldCheck, Handshake, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const features = [
  {
    icon: Library,
    title: 'Browse Collections',
    description: "Buy subject based collections curated for your institution's needs.",
    cta: 'Explore Collections',
    action: 'navigate' as const,
    path: '/collections',
  },
  {
    icon: BookOpen,
    title: 'Purchase Individual Titles',
    description: 'Select and purchase individual books from top medical publishers.',
    cta: 'Shop Titles',
    action: 'navigate' as const,
    path: '/library',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance Packages',
    description: 'Access specialized bundles covering essential guidelines and compliance.',
    cta: 'View Packages',
    action: 'navigate' as const,
    path: '/subscribe',
  },
  {
    icon: Handshake,
    title: 'White-Label Library Solutions',
    description: 'Offer a branded, custom library powered by Rittenhouse.',
    cta: 'Learn More',
    action: 'modal' as const,
    path: '',
  },
];

export function LandingFeatures() {
  const navigate = useNavigate();
  const [contactOpen, setContactOpen] = useState(false);

  const handleClick = (f: typeof features[number]) => {
    if (f.action === 'modal') {
      setContactOpen(true);
    } else {
      navigate(f.path);
    }
  };

  return (
    <>
      <section className="relative z-10 pb-16 px-4 -mt-4 bg-gradient-to-b from-[#1a3a5c] to-[#f0f4f8] pt-8">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map(f => (
              <div
                key={f.title}
                className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-6 flex flex-col items-center text-center border border-blue-100"
              >
                <f.icon className="h-12 w-12 text-blue-700 mb-4" strokeWidth={1.5} />
                <h3 className="text-lg font-bold text-blue-950 mb-2">{f.title}</h3>
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

      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">White-Label Library Solutions</DialogTitle>
            <DialogDescription>
              Interested in a branded, custom library for your institution? Reach out to our team.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Our enterprise team will work with you to design a fully branded digital library experience powered by Rittenhouse.
            </p>
            <Button
              asChild
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold"
            >
              <a href="mailto:enterprise@rittenhouse.com?subject=White-Label%20Library%20Inquiry">
                <Mail className="mr-2 h-4 w-4" />
                Contact Enterprise Team
              </a>
            </Button>
            <Button variant="outline" onClick={() => navigate('/subscribe')} className="w-full">
              View Pricing Plans
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
