/**
 * §11.1 Trial Assessment Page — Public route (no auth required)
 * Multi-step wizard: Company Info → Upload CSV → Processing → Results
 */
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { TrialResultsResponse } from '@/lib/api';
import { formatCompactCurrency, formatFullCurrency } from '@/lib/format-currency';
import { parseCsv, downloadTemplate, INGEST_DOMAINS } from '@/lib/ingest-client';
import { useTenantCurrency } from '@/stores/appStore';
import { Upload, CheckCircle2, AlertTriangle, ArrowRight, Loader2, Shield, BarChart3, TrendingUp, FileText, Lock, Download } from 'lucide-react';

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

  // Upload state — the prospect picks which domain their CSV represents (the
  // lazy honest alternative to a column-mapping wizard) and uploads a real file.
  const [domain, setDomain] = useState('invoices');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real engine progress from /api/trial/:id/status — no hardcoded pipeline.
  const [procProgress, setProcProgress] = useState<number | null>(null);
  const [procStep, setProcStep] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

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
    if (!file) {
      setError('Please choose a CSV file to upload.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Parse the prospect's REAL file into { header, rows } and ingest it under
      // the chosen domain. The detectors run on exactly these rows.
      const { header, rows } = await parseCsv(file);
      if (!rows.length) throw new Error('That CSV had no data rows.');
      await api.trial.upload(trialId, { domains: { [domain]: { header, rows } } });
      await api.trial.run(trialId);
      setStep('processing');
      pollStatus(trialId);
    } catch (err) {
      // Surface validation errors (422) honestly — e.g. columns that don't match
      // the template — rather than silently dropping the upload.
      const e = err as Error;
      const body = err instanceof ApiError ? (err.body as { errors?: Array<{ message: string }> } | undefined) : undefined;
      const detail = body?.errors?.length ? `${e.message}: ${body.errors.slice(0, 3).map(x => x.message).join('; ')}` : e.message;
      setError(detail);
      setLoading(false);
    }
  };

  const pollStatus = async (id: string) => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await api.trial.status(id);
        setProcProgress(typeof status.progress === 'number' ? status.progress : null);
        setProcStep(status.currentStep ?? null);
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

  // "Download Full Report" must actually download — every figure comes from
  // the real /api/trial/:id/report payload, nulls rendered as em-dashes.
  const handleDownloadReport = async () => {
    if (!trialId || reportBusy) return;
    setReportBusy(true);
    setError(null);
    try {
      const r = await api.trial.report(trialId);
      const money = (n: number | null) => (n === null || n === undefined ? '—' : formatFullCurrency(n, currency));
      const lines = [
        `Atheon Trial Assessment — ${r.companyName}`,
        `Industry: ${r.industry}`,
        `Generated: ${r.generatedAt}`,
        '',
        `Health score: ${r.healthScore ?? '—'}`,
        `Findings: ${r.issuesFound ?? '—'}`,
        `Confirmed exposure (confidence-gated): ${money(r.estimatedExposure)}`,
        '',
        'Top risks:',
        ...(r.topRisks.length ? r.topRisks.map((t) => `  - ${t.title} (${money(t.impact)}): ${t.description}`) : ['  —']),
        '',
        'Top opportunities:',
        ...(r.topOpportunities.length ? r.topOpportunities.map((t) => `  - ${t.title} (${money(t.value)}): ${t.description}`) : ['  —']),
        '',
        'Trial data is automatically deleted after 7 days.',
      ];
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `atheon-trial-report-${r.companyName.replace(/\W+/g, '-').toLowerCase()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report generation failed. Please try again.');
    } finally {
      setReportBusy(false);
    }
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
              <div className="text-sm font-semibold t-primary">Atheon</div>
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
            <p className="t-secondary text-sm mb-6">Choose which data this file holds, then upload a CSV. We detect exposure only from the real rows you provide — nothing is invented.</p>

            {/* Domain picker — the prospect tells us what the file is (lightweight, honest) */}
            <div className="mb-4">
              <label className="block text-label mb-1.5">Data Type</label>
              <select
                value={domain} onChange={(e) => setDomain(e.target.value)}
                className="w-full px-4 py-2.5 rounded-sm border t-primary text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
              >
                {INGEST_DOMAINS.map((d) => (
                  <option key={d.domain} value={d.domain} style={{ background: 'var(--bg-card-solid)' }}>{d.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => downloadTemplate(domain)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <Download size={12} aria-hidden="true" />
                Download the {domain} column template
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
            />
            <div
              role="button" tabIndex={0}
              className="border-2 border-dashed rounded-sm p-12 cursor-pointer active:scale-[0.99] text-center transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: file ? 'var(--accent)' : 'var(--border-card)', background: 'var(--bg-secondary)' }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              {file ? <CheckCircle2 size={40} className="mx-auto mb-4 text-accent" aria-hidden="true" /> : <Upload size={40} className="mx-auto mb-4 t-muted" aria-hidden="true" />}
              <p className="text-sm t-primary font-medium mb-1">{file ? file.name : 'Click to choose a CSV'}</p>
              <p className="text-xs t-muted">{file ? 'Ready to analyse — click Run Assessment' : 'Headers must match the template above'}</p>
            </div>

            <button
              onClick={handleUpload}
              disabled={loading || !file}
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

            {/* Real progress as reported by the engine — no hardcoded checkmarks. */}
            <p className="text-label mb-4">Analysis Pipeline</p>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={procProgress ?? undefined}>
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, procProgress ?? 0))}%` }} />
            </div>
            <p className="text-sm t-secondary mt-3 font-mono tnum">
              {procProgress !== null ? `${Math.round(procProgress)}%` : '—'} · {procStep ?? 'Waiting for engine…'}
            </p>
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

            {/* Honest insufficient-data state — no number is shown */}
            {results.insufficientData ? (
              <div className="rounded-lg border p-8" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }} data-testid="insufficient-data">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} style={{ color: 'var(--warning)' }} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="text-lg font-semibold t-primary mb-1">We couldn't confirm exposure from this data</h3>
                    <p className="text-sm t-secondary max-w-xl">
                      Nothing in the uploaded file cleared our confidence gate, so we won't put a number on it —
                      a fabricated figure would be worse than none. Richer data (more rows, or additional data types
                      like purchase orders and bank transactions) lets our detectors confirm real Rand exposure.
                      Book a call and we'll walk your data through it.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Hero: detected exposure — Σ confidence-gated findings, ERP-evidenced */}
                <div className="rounded-lg border p-7" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }} data-testid="exposure-hero">
                  <div className="flex items-center justify-between">
                    <p className="text-label">Detected Exposure</p>
                    {/* Trial evidence is the uploaded CSV, not a live ERP sync — label it as such. */}
                    <span className="pill-success inline-flex items-center rounded-full border px-3 py-1 text-label">Evidenced from your upload</span>
                  </div>
                  <div className="mt-3 text-5xl sm:text-6xl font-bold font-mono tnum leading-none" style={{ color: 'var(--neg)' }}>
                    {formatFullCurrency(results.estimatedExposure, currency)}
                  </div>
                  <p className="text-sm t-secondary mt-3">
                    Across {results.issuesFound ?? 0} finding{results.issuesFound === 1 ? '' : 's'} · every Rand traces to your uploaded rows
                  </p>
                </div>

                {/* Findings — each is real, gated, drillable to affected records */}
                {results.findings.length > 0 && (
                  <div className="rounded-lg border p-6" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
                    <h3 className="text-label mb-4">Findings</h3>
                    <ul className="space-y-3">
                      {results.findings.slice(0, 12).map((f, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 border-b last:border-0 pb-3 last:pb-0" style={{ borderColor: 'var(--divider)' }}>
                          <div>
                            <span className="text-sm font-medium t-primary">{f.title}</span>
                            <span className="text-xs t-muted ml-2">{f.affected_count} record{f.affected_count === 1 ? '' : 's'} · ~{Math.round(f.confidence * 100)}% confidence</span>
                          </div>
                          <span className="font-mono tnum text-sm shrink-0" style={{ color: 'var(--neg)' }}>{formatCompactCurrency(f.value_at_risk_zar, currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Exposure by category — derived from real findings, not invented splits */}
                {results.topRisks.length > 0 && (
                  <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-card-solid)', borderColor: `rgb(var(--neg-rgb) / 0.22)`, boxShadow: 'var(--shadow-card)' }}>
                    <h3 className="text-label mb-4 flex items-center gap-2" style={{ color: 'var(--neg)' }}>
                      <AlertTriangle size={13} aria-hidden="true" /> Exposure by Area
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
              </>
            )}

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
                  <p className="text-label text-accent mb-2">Recover This</p>
                  <h3 className="text-2xl font-bold t-primary mb-1">{results.insufficientData ? 'Talk to us about your data' : 'Want us to recover this exposure?'}</h3>
                  <p className="text-sm t-secondary max-w-lg">Book a call and our team will walk your ERP data through the full engine — historical analysis, root-cause, and a recovery plan tied to real Rand.</p>
                </div>
                <div className="flex flex-col gap-3 md:items-end">
                  {/* Goes to the marketing contact form — not the login page. */}
                  <a href="/#cta-s" className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
                    <ArrowRight size={16} aria-hidden="true" />
                    Book a call
                  </a>
                  {!results.insufficientData && (
                    <button
                      onClick={() => void handleDownloadReport()}
                      disabled={reportBusy}
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-sm border t-primary text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:opacity-50"
                      style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}
                    >
                      {reportBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                      {reportBusy ? 'Preparing…' : 'Download Full Report'}
                    </button>
                  )}
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
