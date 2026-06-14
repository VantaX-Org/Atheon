/**
 * §11.1 Trial Assessment Page — Public route (no auth required)
 * Multi-step wizard: Company Info → Upload CSV → Processing → Results
 */
import { useState } from 'react';
import { api } from '@/lib/api';
import type { TrialResultsResponse } from '@/lib/api';
import { formatCompactCurrency } from '@/lib/format-currency';
import { useTenantCurrency } from '@/stores/appStore';
import { Upload, CheckCircle2, AlertTriangle, ArrowRight, Loader2, Shield, BarChart3, TrendingUp, FileText, Lock } from 'lucide-react';

type Step = 'info' | 'upload' | 'processing' | 'results';

const INDUSTRIES = ['fmcg', 'healthcare', 'mining', 'agriculture', 'logistics', 'technology', 'manufacturing', 'retail', 'general'];

const STEP_LABELS: Record<Step, string> = {
  info: 'Step 01 — Company',
  upload: 'Step 02 — Upload Data',
  processing: 'Step 03 — Analysing',
  results: 'Step 04 — Results',
};

export function TrialPage() {
  const currency = useTenantCurrency();
  const [step, setStep] = useState<Step>('info');
  const [trialId, setTrialId] = useState<string | null>(null);
  const [results, setResults] = useState<TrialResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const handleStart = async () => {
    if (!companyName || !contactName || !contactEmail) {
      setError('Please fill in all required fields');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.trial.start({ company_name: companyName, industry, contact_name: contactName, contact_email: contactEmail });
      setTrialId(res.id);
      setStep('upload');
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const handleUpload = async () => {
    if (!trialId) return;
    setLoading(true);
    setError(null);
    try {
      // Simulate CSV upload metadata (in production this would parse an actual file)
      await api.trial.upload(trialId, { filename: 'trial-data.csv', row_count: 100, columns: ['date', 'amount', 'category', 'status'] });
      await api.trial.run(trialId);
      setStep('processing');
      // Poll for completion
      pollStatus(trialId);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await api.trial.status(id);
        if (status.status === 'complete') {
          const res = await api.trial.results(id);
          setResults(res);
          setStep('results');
          setLoading(false);
          return;
        }
        if (status.status === 'failed') {
          setError('Assessment processing failed. Please try again.');
          setLoading(false);
          return;
        }
      } catch {
        // continue polling
      }
    }
    setError('Assessment timed out. Please check back later.');
    setLoading(false);
  };

  const stepOrder: Step[] = ['info', 'upload', 'processing', 'results'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b px-6 py-4" style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-solid)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-accent" aria-hidden="true" />
            <div className="leading-tight">
              <div className="text-sm font-semibold t-primary">Atheon Luminous Editorial</div>
              <div className="text-label">Financial-assurance SaaS</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-label" style={{ background: 'var(--accent-subtle)', borderColor: 'rgb(var(--accent-rgb) / 0.20)', color: 'var(--accent)' }}>Trial</span>
            <a href="/" className="text-xs t-muted hover:t-primary transition-colors">← Back to Home</a>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Page title / status eyebrow */}
        <div className="mb-10">
          <p className="text-label mb-2">Free Trial Assessment</p>
          <h1 className="text-4xl sm:text-5xl font-bold t-primary tracking-tight uppercase">Trial Activation</h1>
          <p className="text-label mt-3" style={{ color: 'var(--text-secondary)' }}>
            Status: Active · {STEP_LABELS[step]}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mb-12" role="list" aria-label="Trial progress">
          {stepOrder.map((s, i) => {
            const reached = stepOrder.indexOf(step) > i;
            const current = step === s;
            return (
              <div key={s} className="flex items-center gap-2" role="listitem">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
                    current ? 'bg-accent text-[var(--text-on-accent)]' : reached ? 'text-accent' : 't-muted'
                  }`}
                  style={
                    !current && reached
                      ? { background: `rgb(var(--accent-rgb) / 0.12)` }
                      : !current
                      ? { background: 'var(--bg-secondary)' }
                      : undefined
                  }
                  aria-current={current ? 'step' : undefined}
                >
                  {reached ? '✓' : i + 1}
                </div>
                {i < 3 && (
                  <div
                    className="w-12 h-0.5"
                    style={{ background: reached ? `rgb(var(--accent-rgb) / 0.35)` : 'var(--divider)' }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-sm border text-sm flex items-center gap-2" style={{ background: `rgb(var(--neg-rgb) / 0.07)`, borderColor: `rgb(var(--neg-rgb) / 0.25)` }}>
            <AlertTriangle size={14} style={{ color: 'var(--neg)' }} aria-hidden="true" />
            <span style={{ color: 'var(--neg)' }}>{error}</span>
          </div>
        )}

        {/* Step 1: Company Information */}
        {step === 'info' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
            {/* Form card */}
            <div className="rounded-lg border p-7" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-label mb-2">Get Started</p>
              <h2 className="text-2xl font-bold t-primary mb-1">Discover Your Organisation's Health</h2>
              <p className="t-secondary text-sm mb-6 max-w-md">Get a free assessment of your operational health with actionable insights. No commitment required — results in minutes.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-label mb-1.5">Company Name *</label>
                  <input
                    type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                    placeholder="Acme Corporation"
                  />
                </div>
                <div>
                  <label className="block text-label mb-1.5">Industry *</label>
                  <select
                    value={industry} onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                  >
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind} style={{ background: 'var(--bg-card-solid)' }}>{ind.charAt(0).toUpperCase() + ind.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-label mb-1.5">Your Name *</label>
                  <input
                    type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="block text-label mb-1.5">Email Address *</label>
                  <input
                    type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                    placeholder="john@acme.co.za"
                  />
                </div>

                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="w-full py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  {loading ? 'Starting...' : 'Start Free Assessment'}
                </button>

                <p className="text-caption t-muted">
                  Your data is encrypted and automatically deleted after 7 days. No payment information required.
                </p>
              </div>
            </div>

            {/* What you get — editorial value-props card */}
            <div className="rounded-lg border p-7" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-label mb-4">What Your Assessment Includes</p>
              <ul className="space-y-5">
                {[
                  { icon: BarChart3, title: 'Operational Health Score', desc: 'A benchmarked read on the state of your operation.' },
                  { icon: AlertTriangle, title: 'Risk & Exposure Findings', desc: 'Surfaced issues ranked by financial impact.' },
                  { icon: TrendingUp, title: 'Projected ROI Potential', desc: 'Quantified upside from acting on opportunities.' },
                  { icon: FileText, title: 'Downloadable Full Report', desc: 'Shareable summary for your team and board.' },
                ].map(({ icon: Icon, title, desc }) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ background: 'var(--accent-subtle)' }}>
                      <Icon size={16} className="text-accent" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold t-primary">{title}</div>
                      <div className="text-xs t-secondary mt-0.5">{desc}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: Upload Data */}
        {step === 'upload' && (
          <div className="rounded-lg border p-8 max-w-2xl mx-auto" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-label mb-2">Step 02</p>
            <h2 className="text-2xl font-bold t-primary mb-1">Upload Your Data</h2>
            <p className="t-secondary text-sm mb-6">Upload a CSV file with your transactional or operational data for analysis.</p>

            <div
              className="border-2 border-dashed rounded-sm p-12 cursor-pointer active:scale-[0.99] text-center transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-card)', background: 'var(--bg-secondary)' }}
              onClick={handleUpload}
            >
              <Upload size={40} className="mx-auto mb-4 t-muted" aria-hidden="true" />
              <p className="text-sm t-primary font-medium mb-1">Click to upload CSV</p>
              <p className="text-xs t-muted">Or drag and drop your file here</p>
            </div>

            <button
              onClick={handleUpload}
              disabled={loading}
              className="mt-6 w-full py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
              {loading ? 'Processing...' : 'Run Assessment'}
            </button>
          </div>
        )}

        {/* Step 3: Processing — feature-unlock-checklist style */}
        {step === 'processing' && (
          <div className="rounded-lg border p-8 max-w-2xl mx-auto" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-label mb-2">Step 03</p>
                <h2 className="text-2xl font-bold t-primary mb-1">Analysing Your Data</h2>
                <p className="t-secondary text-sm">Our AI engine is processing your data. This typically takes 1-3 minutes.</p>
              </div>
              <Loader2 size={28} className="text-accent animate-spin shrink-0 mt-1" aria-hidden="true" />
            </div>

            <p className="text-label mb-4">Analysis Pipeline</p>
            <div className="space-y-3">
              {['Ingesting data', 'Running health check', 'Identifying risks', 'Calculating ROI potential', 'Generating report'].map((label, i) => {
                const done = i < 2;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-sm border px-4 py-3" style={{ borderColor: 'var(--border-card)', background: done ? 'var(--accent-subtle)' : 'var(--bg-secondary)' }}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${done ? 'text-accent' : 't-muted'}`}
                      style={{ background: done ? `rgb(var(--accent-rgb) / 0.16)` : 'var(--bg-card-solid)' }}>
                      {done ? <CheckCircle2 size={12} /> : <span className="text-caption font-mono">{i + 1}</span>}
                    </div>
                    <span className={`text-sm ${done ? 't-primary font-medium' : 't-muted'}`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && results && (
          <div className="space-y-6">
            <div>
              <p className="text-label mb-2">Assessment Complete</p>
              <h2 className="text-3xl font-bold t-primary">Your Assessment Results</h2>
              <p className="text-label mt-2" style={{ color: 'var(--text-secondary)' }}>
                {results.companyName} · {results.industry.charAt(0).toUpperCase() + results.industry.slice(1)}
              </p>
            </div>

            {/* Hero metric + supporting metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 items-stretch">
              {/* Hero: Health Score */}
              <div className="rounded-lg border p-7 flex flex-col justify-between" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-label">Health Score</p>
                  <span className="pill-success inline-flex items-center rounded-full border px-3 py-1 text-label">Assessed</span>
                </div>
                <div className="flex items-end gap-3 mt-4">
                  <span className="text-7xl font-bold font-mono tnum text-accent leading-none">{results.healthScore ?? '—'}</span>
                  <span className="text-label mb-2">/ 100</span>
                </div>
              </div>

              {/* Issues + ROI stacked */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="rounded-lg border p-6 flex flex-col justify-between" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                  <p className="text-label">Issues Found</p>
                  <span className="text-4xl font-bold font-mono tnum mt-4" style={{ color: 'var(--warning)' }}>{results.issuesFound ?? 0}</span>
                </div>
                <div className="rounded-lg border p-6 flex flex-col justify-between" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-label">Projected ROI</p>
                    <TrendingUp size={16} className="text-accent" aria-hidden="true" />
                  </div>
                  <span className="text-4xl font-bold font-mono tnum text-accent mt-4">
                    {results.projectedRoi ? `${results.projectedRoi.toFixed(1)}x` : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Risks & Opportunities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {results.topRisks.length > 0 && (
                <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-card-solid)', borderColor: `rgb(var(--neg-rgb) / 0.22)`, boxShadow: 'var(--shadow-card)' }}>
                  <h3 className="text-label mb-4 flex items-center gap-2" style={{ color: 'var(--neg)' }}>
                    <AlertTriangle size={13} aria-hidden="true" /> Top Risks
                  </h3>
                  <ul className="space-y-3">
                    {results.topRisks.map((risk, i) => (
                      <li key={i} className="text-sm t-secondary flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--neg)' }} aria-hidden="true" />
                        <div>
                          <span className="font-medium t-primary">{risk.title}</span>
                          <span className="t-muted"> — {risk.description}</span>
                          {risk.impact > 0 && <span className="font-mono tnum ml-1" style={{ color: 'var(--neg)' }}>({formatCompactCurrency(risk.impact, currency)})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.topOpportunities.length > 0 && (
                <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-card-solid)', borderColor: `rgb(var(--accent-rgb) / 0.22)`, boxShadow: 'var(--shadow-card)' }}>
                  <h3 className="text-label text-accent mb-4 flex items-center gap-2">
                    <TrendingUp size={13} aria-hidden="true" /> Top Opportunities
                  </h3>
                  <ul className="space-y-3">
                    {results.topOpportunities.map((opp, i) => (
                      <li key={i} className="text-sm t-secondary flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                        <div>
                          <span className="font-medium t-primary">{opp.title}</span>
                          <span className="t-muted"> — {opp.description}</span>
                          {opp.value > 0 && <span className="text-accent font-mono tnum ml-1">({formatCompactCurrency(opp.value, currency)})</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Upgrade CTA — royal-blue accent card */}
            <div
              className="rounded-lg border p-8"
              style={{
                background: `linear-gradient(135deg, rgb(var(--accent-rgb) / 0.10) 0%, rgb(var(--accent-rgb) / 0.03) 60%, transparent 100%), var(--bg-card-solid)`,
                borderColor: `rgb(var(--accent-rgb) / 0.22)`,
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
                <div>
                  <p className="text-label text-accent mb-2">Unlock Everything</p>
                  <h3 className="text-2xl font-bold t-primary mb-1">Start Your Full Atheon Journey</h3>
                  <p className="text-sm t-secondary max-w-lg">Full historical analysis, unlimited collaborators, priority support, and AI-driven risk assessment across your entire operation.</p>
                </div>
                <div className="flex flex-col gap-3 md:items-end">
                  <a href="/login" className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
                    <ArrowRight size={16} aria-hidden="true" />
                    Get Started
                  </a>
                  <button
                    onClick={async () => {
                      if (trialId) {
                        try {
                          await api.trial.report(trialId);
                        } catch { /* report generation is best-effort */ }
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-sm border t-primary text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
                    style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}
                  >
                    <FileText size={14} aria-hidden="true" />
                    Download Full Report
                  </button>
                </div>
              </div>
            </div>

            <p className="text-label flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <Lock size={12} aria-hidden="true" />
              This trial data will be automatically deleted in 7 days.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
