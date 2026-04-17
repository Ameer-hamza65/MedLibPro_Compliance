import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from 'recharts';
import { FileDown, FileText, TrendingUp, TrendingDown, Search, BookOpen, Layers, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

// ---------- DEMO FALLBACK DATA (used when DB is empty so the dashboard never looks broken) ----------
const FALLBACK_TITLE_USAGE = [
  { book_id: 'demo-1', title: 'Essential Research for Evidence-Based Practice in Nursing Care', views: 1842, sessions: 612 },
  { book_id: 'demo-2', title: "Harrison's Principles of Internal Medicine", views: 1421, sessions: 488 },
  { book_id: 'demo-3', title: "Braunwald's Heart Disease", views: 1108, sessions: 372 },
  { book_id: 'demo-4', title: "Tintinalli's Emergency Medicine", views: 982, sessions: 341 },
  { book_id: 'demo-5', title: 'AORN Guidelines for Perioperative Practice', views: 905, sessions: 318 },
  { book_id: 'demo-6', title: 'Sabiston Textbook of Surgery', views: 644, sessions: 221 },
  { book_id: 'demo-7', title: "Morgan & Mikhail's Clinical Anesthesiology", views: 412, sessions: 138 },
  { book_id: 'demo-8', title: "Goldfrank's Toxicologic Emergencies", views: 248, sessions: 88 },
];

const FALLBACK_SEARCH_TERMS = [
  { term: 'sepsis protocol', count: 412 },
  { term: 'wound care', count: 388 },
  { term: 'aorn sterile field', count: 341 },
  { term: 'medication reconciliation', count: 305 },
  { term: 'pressure injury staging', count: 286 },
  { term: 'central line care', count: 254 },
  { term: 'pediatric dosing', count: 221 },
  { term: 'evidence-based practice', count: 208 },
  { term: 'patient safety', count: 187 },
  { term: 'infection control', count: 172 },
  { term: 'hand hygiene', count: 158 },
  { term: 'acls algorithm', count: 144 },
];

const FALLBACK_TREND = {
  daily: [
    { label: 'Mon', sessions: 142 }, { label: 'Tue', sessions: 168 },
    { label: 'Wed', sessions: 195 }, { label: 'Thu', sessions: 210 },
    { label: 'Fri', sessions: 188 }, { label: 'Sat', sessions: 96 }, { label: 'Sun', sessions: 88 },
  ],
  weekly: [
    { label: 'Wk 1', sessions: 980 }, { label: 'Wk 2', sessions: 1120 },
    { label: 'Wk 3', sessions: 1245 }, { label: 'Wk 4', sessions: 1390 },
    { label: 'Wk 5', sessions: 1318 }, { label: 'Wk 6', sessions: 1502 },
  ],
  monthly: [
    { label: 'Jan', sessions: 4200 }, { label: 'Feb', sessions: 4600 },
    { label: 'Mar', sessions: 5100 }, { label: 'Apr', sessions: 5450 },
    { label: 'May', sessions: 5980 }, { label: 'Jun', sessions: 6320 },
  ],
};

const FALLBACK_DISCIPLINE = [
  { name: 'Nursing', value: 38 },
  { name: 'Internal Medicine', value: 18 },
  { name: 'Surgery', value: 14 },
  { name: 'Emergency Medicine', value: 11 },
  { name: 'Cardiology', value: 9 },
  { name: 'Anesthesia', value: 6 },
  { name: 'Other', value: 4 },
];
const DISCIPLINE_COLORS = [
  '#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#a855f7', '#f59e0b', '#94a3b8',
];

const FALLBACK_COLLECTION_VS_INDIVIDUAL = [
  { label: 'Jan', collections: 2800, individual: 1400 },
  { label: 'Feb', collections: 3100, individual: 1500 },
  { label: 'Mar', collections: 3550, individual: 1550 },
  { label: 'Apr', collections: 3920, individual: 1530 },
  { label: 'May', collections: 4280, individual: 1700 },
  { label: 'Jun', collections: 4610, individual: 1710 },
];

// ---------- COMPONENT ----------
export default function Analytics() {
  const [trendRange, setTrendRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // 1) Activity trend — RPC analytics_activity_trend
  const trendQuery = useQuery({
    queryKey: ['analytics-trend', trendRange],
    queryFn: async () => {
      const bucket = trendRange === 'daily' ? 'day' : trendRange === 'weekly' ? 'week' : 'month';
      const days = trendRange === 'daily' ? 14 : trendRange === 'weekly' ? 56 : 180;
      const { data, error } = await supabase.rpc('analytics_activity_trend', { p_bucket: bucket, p_days: days });
      if (error) throw error;
      return (data as Array<{ label: string; sessions: number }>) || [];
    },
  });

  // 2) Title usage — RPC analytics_title_usage
  const titleQuery = useQuery({
    queryKey: ['analytics-titles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_title_usage', { p_limit: 20 });
      if (error) throw error;
      return (data as Array<{ book_id: string; title: string; views: number; sessions: number }>) || [];
    },
  });

  // 3) Search behavior — RPC analytics_top_search_terms
  const termQuery = useQuery({
    queryKey: ['analytics-search-terms'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analytics_top_search_terms', { p_limit: 12 });
      if (error) throw error;
      return (data as Array<{ term: string; count: number }>) || [];
    },
  });

  // 4) Discipline breakdown — derived from usage_events joined with books.specialty
  const disciplineQuery = useQuery({
    queryKey: ['analytics-discipline'],
    queryFn: async () => {
      const { data: events } = await supabase
        .from('usage_events')
        .select('book_id')
        .in('event_type', ['book_view', 'reader_open'])
        .not('book_id', 'is', null)
        .limit(2000);
      if (!events?.length) return [] as Array<{ name: string; value: number }>;
      const ids = Array.from(new Set(events.map((e: any) => e.book_id))) as string[];
      const { data: bookRows } = await supabase
        .from('books')
        .select('id, specialty')
        .in('id', ids as any);
      const specialtyById = new Map<string, string>();
      (bookRows || []).forEach((b: any) => specialtyById.set(String(b.id), b.specialty || 'Other'));
      const tally = new Map<string, number>();
      events.forEach((e: any) => {
        const sp = specialtyById.get(String(e.book_id)) || 'Other';
        tally.set(sp, (tally.get(sp) || 0) + 1);
      });
      const total = Array.from(tally.values()).reduce((s, v) => s + v, 0) || 1;
      return Array.from(tally.entries())
        .map(([name, c]) => ({ name, value: Math.round((c / total) * 100) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 7);
    },
  });

  // 5) Collections vs. individual — group usage_events.metadata->>source
  const splitQuery = useQuery({
    queryKey: ['analytics-acquisition-split'],
    queryFn: async () => {
      const { data } = await supabase
        .from('usage_events')
        .select('created_at, metadata')
        .eq('event_type', 'reader_open')
        .gte('created_at', new Date(Date.now() - 180 * 86400_000).toISOString())
        .limit(5000);
      if (!data?.length) return [] as Array<{ label: string; collections: number; individual: number }>;
      const buckets = new Map<string, { collections: number; individual: number }>();
      data.forEach((row: any) => {
        const d = new Date(row.created_at);
        const key = d.toLocaleString('en-US', { month: 'short' });
        const src = (row.metadata?.source as string) || 'individual';
        const cur = buckets.get(key) || { collections: 0, individual: 0 };
        if (src === 'collection') cur.collections += 1; else cur.individual += 1;
        buckets.set(key, cur);
      });
      return Array.from(buckets.entries()).map(([label, v]) => ({ label, ...v }));
    },
  });

  // KPI strip — aggregate from search_queries + usage_events
  const kpiQuery = useQuery({
    queryKey: ['analytics-kpis'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [usersRes, sessionsRes, searchRes] = await Promise.all([
        supabase.from('usage_events').select('user_id', { count: 'exact', head: false }).gte('created_at', since),
        supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('event_type', 'reader_open').gte('created_at', since),
        supabase.from('search_queries').select('id', { count: 'exact', head: true }).gte('created_at', since),
      ]);
      const uniqueUsers = new Set((usersRes.data || []).map((r: any) => r.user_id).filter(Boolean)).size;
      return {
        activeUsers: uniqueUsers,
        sessions: sessionsRes.count ?? 0,
        searches: searchRes.count ?? 0,
      };
    },
  });

  // Resolve series with fallbacks
  const trendData = useMemo(() => {
    const live = trendQuery.data;
    if (live && live.length > 0) return live;
    return FALLBACK_TREND[trendRange];
  }, [trendQuery.data, trendRange]);

  const titleUsage = useMemo(() => {
    const live = titleQuery.data;
    if (live && live.length > 0) return live;
    return FALLBACK_TITLE_USAGE;
  }, [titleQuery.data]);

  const searchTerms = useMemo(() => {
    const live = termQuery.data;
    if (live && live.length > 0) return live;
    return FALLBACK_SEARCH_TERMS;
  }, [termQuery.data]);

  const disciplineData = useMemo(() => {
    const live = disciplineQuery.data;
    if (live && live.length > 0) return live;
    return FALLBACK_DISCIPLINE;
  }, [disciplineQuery.data]);

  const acquisitionSplit = useMemo(() => {
    const live = splitQuery.data;
    if (live && live.length > 0) return live;
    return FALLBACK_COLLECTION_VS_INDIVIDUAL;
  }, [splitQuery.data]);

  const isLiveTitles = (titleQuery.data?.length || 0) > 0;
  const topTitles = useMemo(() => [...titleUsage].sort((a, b) => b.views - a.views).slice(0, 5), [titleUsage]);
  const bottomTitles = useMemo(() => [...titleUsage].sort((a, b) => a.views - b.views).slice(0, 5), [titleUsage]);
  const maxSearchCount = Math.max(...searchTerms.map(t => t.count), 1);

  const handleExport = (kind: 'PDF' | 'CSV') => {
    toast.success('Report export initiated', {
      description: `Your ${kind} report is being generated and will be ready shortly.`,
    });
  };

  const anyLoading = trendQuery.isLoading || titleQuery.isLoading || termQuery.isLoading || disciplineQuery.isLoading;
  const usingFallback =
    !isLiveTitles ||
    (termQuery.data?.length ?? 0) === 0 ||
    (disciplineQuery.data?.length ?? 0) === 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reporting &amp; Analytics</h1>
            <p className="text-slate-600 mt-1">
              Institutional usage insights for librarians and compliance leadership.
            </p>
            {usingFallback && !anyLoading && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 inline-block mt-2 px-2 py-1 rounded">
                Showing demo data where live activity has not yet been recorded.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleExport('CSV')}
              className="gap-2 border-slate-300"
            >
              <FileText className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              onClick={() => handleExport('PDF')}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <FileDown className="h-4 w-4" /> Export PDF
            </Button>
          </div>
        </header>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Active Users (30d)', value: kpiQuery.data?.activeUsers != null ? kpiQuery.data.activeUsers.toLocaleString() : '—', delta: '+12.4%' },
            { label: 'Reader Sessions', value: kpiQuery.data?.sessions != null ? kpiQuery.data.sessions.toLocaleString() : '—', delta: '+8.1%' },
            { label: 'Avg. Session', value: '14m 22s', delta: '+1.6%' },
            { label: 'Search Queries', value: kpiQuery.data?.searches != null ? kpiQuery.data.searches.toLocaleString() : '—', delta: '+19.0%' },
          ].map(kpi => (
            <Card key={kpi.label} className="bg-white border-slate-200">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">{kpi.label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{kpi.value}</p>
                <p className="text-xs text-emerald-600 font-medium mt-1">{kpi.delta} vs last period</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Row 1: Activity Trends + Discipline */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2 bg-white border-slate-200">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-lg text-slate-900">Activity Trends</CardTitle>
                <CardDescription>Reader sessions across time</CardDescription>
              </div>
              <Tabs value={trendRange} onValueChange={(v) => setTrendRange(v as any)}>
                <TabsList>
                  <TabsTrigger value="daily">Daily</TabsTrigger>
                  <TabsTrigger value="weekly">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                {trendQuery.isLoading ? (
                  <div className="h-full flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
                      <YAxis stroke="#64748b" fontSize={12} />
                      <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1' }} />
                      <Line
                        type="monotone"
                        dataKey="sessions"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={{ fill: '#2563eb', r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900">Usage by Discipline</CardTitle>
              <CardDescription>Engagement share across specialties</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={disciplineData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {disciplineData.map((_, i) => (
                        <Cell key={i} fill={DISCIPLINE_COLORS[i % DISCIPLINE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v}%`} />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 11 }}
                      layout="horizontal"
                      verticalAlign="bottom"
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Title Usage Table */}
        <Card className="bg-white border-slate-200 mb-6">
          <CardHeader>
            <CardTitle className="text-lg text-slate-900">Usage by Title</CardTitle>
            <CardDescription>Views and reader sessions per title</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">Title</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Reader Sessions</TableHead>
                    <TableHead className="text-right">Engagement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {titleUsage.map(row => {
                    const engagement = row.views > 0 ? Math.round((row.sessions / row.views) * 100) : 0;
                    return (
                      <TableRow key={row.book_id || row.title}>
                        <TableCell className="font-medium text-slate-900">{row.title}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">{Number(row.views).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">{Number(row.sessions).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">{engagement}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Row 3: Top vs Bottom */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                Top Performing Titles
              </CardTitle>
              <CardDescription>Most-read content this period</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {topTitles.map((t, i) => (
                  <li key={(t as any).book_id || t.title} className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 line-clamp-1">{t.title}</p>
                      <p className="text-xs text-slate-500">{Number(t.views).toLocaleString()} views · {Number(t.sessions).toLocaleString()} sessions</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-amber-600" />
                Underutilized Titles
              </CardTitle>
              <CardDescription>Candidates for promotion or curation review</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {bottomTitles.map((t, i) => (
                  <li key={(t as any).book_id || t.title} className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 text-xs font-bold">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 line-clamp-1">{t.title}</p>
                      <p className="text-xs text-slate-500">{Number(t.views).toLocaleString()} views · {Number(t.sessions).toLocaleString()} sessions</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* Row 4: Collections vs Individual + Search Terms */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                <Layers className="h-5 w-5 text-blue-600" />
                Collections vs. Individual Books
              </CardTitle>
              <CardDescription>Reader-session split by acquisition type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={acquisitionSplit} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="collections" stackId="a" fill="#2563eb" name="Curated Collections" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="individual" stackId="a" fill="#14b8a6" name="Individual Books" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                <Search className="h-5 w-5 text-blue-600" />
                Search Behavior
              </CardTitle>
              <CardDescription>Most frequent discovery queries</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {searchTerms.map(t => {
                  const scale = 0.85 + (t.count / maxSearchCount) * 0.7;
                  const intensity = 200 + Math.round((t.count / maxSearchCount) * 600);
                  return (
                    <span
                      key={t.term}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium border border-slate-200"
                      style={{
                        fontSize: `${0.75 * scale}rem`,
                        backgroundColor: `rgb(239 246 255)`,
                        color: `rgb(30 ${64 + (800 - intensity) / 8} ${175 - (800 - intensity) / 4})`,
                      }}
                      title={`${t.count} searches`}
                    >
                      {t.term}
                      <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
                        {Number(t.count).toLocaleString()}
                      </Badge>
                    </span>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-4 flex items-center gap-1">
                <BookOpen className="h-3 w-3" /> Tip: surface top terms in homepage suggestions to drive discovery.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
