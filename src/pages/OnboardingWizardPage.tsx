/**
 * /onboarding — guided wizard walking new users through the 7 stop-gates
 * the Customer Success playbook expects in week 1.
 *
 * Existing OnboardingChecklist on the Dashboard is *passive* (a small
 * collapsible card). This page is *active* — the entire screen is the
 * wizard, with deep-link CTAs for each step. Once all 7 steps clear, the
 * page celebrates and routes back to /dashboard.
 *
 * Steps map to existing app routes:
 *   connect_erp     → /integrations
 *   deploy_catalyst → /catalysts
 *   run_catalyst    → /catalysts
 *   review_action   → /catalysts (Exceptions tab)
 *   view_diagnostics → /pulse
 *   generate_report → /apex
 *   invite_user     → /iam
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  CheckCircle2, ArrowRight, Loader2, Rocket, Sparkles,
} from "lucide-react";
import { AsyncPageContent, statusFrom } from "@/components/ui/async";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { OnboardingStep } from "@/lib/api";

const STEP_TARGETS: Record<string, { route: string; cta: string }> = {
  connect_erp:      { route: '/integrations',                      cta: 'Open Integrations' },
  deploy_catalyst:  { route: '/catalysts',                          cta: 'Open Catalysts' },
  run_catalyst:     { route: '/catalysts',                          cta: 'Open Catalysts' },
  review_action:    { route: '/catalysts',                          cta: 'Open Exceptions queue' },
  view_diagnostics: { route: '/pulse',                              cta: 'Open Pulse · Diagnostics' },
  generate_report:  { route: '/apex',                               cta: 'Open Apex · Briefing' },
  invite_user:      { route: '/iam',                                cta: 'Open IAM · Users' },
};

export function OnboardingWizardPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalSteps, setTotalSteps] = useState(7);
  const [progressPct, setProgressPct] = useState(0);
  const [allComplete, setAllComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await api.onboarding.progress();
      setSteps(data.steps);
      setCompletedCount(data.completedCount);
      setTotalSteps(data.totalSteps);
      setProgressPct(data.progressPct);
      setAllComplete(data.allComplete);
    } catch (err) {
      toast.error('Failed to load onboarding progress', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }

  // Initial load — once-on-mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function markComplete(stepId: string) {
    if (completing) return;
    setCompleting(stepId);
    try {
      await api.onboarding.completeStep(stepId);
      await refresh();
    } catch (err) {
      toast.error('Failed to mark step complete', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setCompleting(null);
    }
  }

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        onRetry={() => void refresh()}
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  const currentStep = steps.find(s => !s.completed);
  const currentIndex = currentStep ? steps.findIndex(s => s.id === currentStep.id) : steps.length - 1;
  const activeStep = currentStep ?? steps[steps.length - 1];
  const activeTarget = activeStep ? STEP_TARGETS[activeStep.id] : undefined;

  // Progress ring geometry — editorial header gauge mirroring the mockup.
  const ringSize = 56;
  const ringStroke = 6;
  const ringR = (ringSize - ringStroke) / 2;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto" data-testid="onboarding-wizard">
      {/* Header strip — eyebrow + progress gauge */}
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Rocket className="w-5 h-5 text-accent" />
          <div>
            <p className="text-label">Onboarding Wizard</p>
            <h1 className="text-headline-lg font-bold t-primary tracking-tight leading-tight">Welcome to Atheon</h1>
          </div>
        </div>

        <Card className="flex items-center gap-4 px-5 py-3">
          <div className="text-right">
            <p className="text-label mb-0.5">Progress</p>
            <p className="text-headline-xl font-bold t-primary leading-none" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>
              {progressPct}%
            </p>
            <p className="text-caption t-muted font-mono mt-1">{completedCount} of {totalSteps} complete</p>
          </div>
          <div className="relative" style={{ width: ringSize, height: ringSize }} aria-hidden="true">
            <svg width={ringSize} height={ringSize} className="-rotate-90">
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                fill="none" stroke="var(--border-card)" strokeWidth={ringStroke}
              />
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringR}
                fill="none"
                stroke={allComplete ? 'var(--rag-healthy)' : 'var(--accent)'}
                strokeWidth={ringStroke}
                strokeLinecap="round"
                strokeDasharray={ringC}
                strokeDashoffset={ringC * (1 - progressPct / 100)}
                className="transition-all duration-500 ease-out"
              />
            </svg>
          </div>
        </Card>
      </header>

      {/* Celebration — sage success card spanning full width */}
      {allComplete && (
        <Card className="p-7 text-center mb-8" style={{ background: 'rgb(var(--rag-healthy-rgb) / 0.08)', border: '1px solid rgb(var(--rag-healthy-rgb) / 0.30)' }}>
          <div
            className="w-14 h-14 rounded-md flex items-center justify-center mx-auto mb-4 border"
            style={{
              background: 'rgb(var(--accent-rgb) / 0.12)',
              borderColor: 'rgb(var(--accent-rgb) / 0.30)',
            }}
            aria-hidden="true"
          >
            <Sparkles className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mb-2">You're set up.</h2>
          <p className="text-body-sm t-muted mb-5 max-w-md mx-auto leading-relaxed">
            All seven first-week milestones complete. Your customer success engineer can now schedule
            the week-4 ROI review.
          </p>
          <Button variant="primary" onClick={() => navigate('/dashboard')}>
            Go to Dashboard <ArrowRight size={14} className="ml-1" />
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left rail — editorial step ladder */}
        <nav aria-label="Onboarding steps" className="space-y-3">
          {steps.map((step, i) => {
            const isCurrent = !step.completed && currentStep?.id === step.id;
            const numLabel = String(i + 1).padStart(2, '0');
            return (
              <Card
                key={step.id}
                className={`p-4 transition-colors ${isCurrent ? '' : 'border-card'}`}
                style={
                  isCurrent
                    ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                    : undefined
                }
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p
                      className="text-headline-xl font-bold leading-none"
                      style={{
                        fontFamily: "'Space Mono', ui-monospace, monospace",
                        color: isCurrent ? '#fff' : step.completed ? 'var(--text-primary)' : 'var(--text-muted)',
                        opacity: !isCurrent && !step.completed ? 0.6 : 1,
                      }}
                    >
                      {numLabel}
                    </p>
                    <p
                      className="text-label mt-2"
                      style={isCurrent ? { color: 'rgba(255,255,255,0.85)' } : undefined}
                    >
                      {step.label}
                    </p>
                  </div>
                  {step.completed && !isCurrent && (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center border flex-shrink-0"
                      style={{
                        background: 'rgb(var(--rag-healthy-rgb) / 0.12)',
                        borderColor: 'rgb(var(--rag-healthy-rgb) / 0.30)',
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--rag-healthy)' }} />
                    </div>
                  )}
                  {step.completed && isCurrent && (
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#fff' }} />
                  )}
                </div>
              </Card>
            );
          })}
        </nav>

        {/* Right panel — active step, presented large + editorial */}
        <Card className="p-8">
          {activeStep && (
            <div className="flex flex-col h-full">
              <div className="flex items-start justify-between gap-6 mb-6">
                <div className="min-w-0">
                  {activeStep.completed && (
                    <StatusPill status="completed" label="Completed" size="sm" />
                  )}
                  {!activeStep.completed && (
                    <StatusPill status="in_progress" label="Current step" size="sm" />
                  )}
                  <h2 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mt-3">
                    {activeStep.label}
                  </h2>
                </div>
                <div className="text-right flex-shrink-0">
                  <p
                    className="text-bold leading-none"
                    style={{
                      fontFamily: "'Space Mono', ui-monospace, monospace",
                      fontSize: '56px',
                      fontWeight: 700,
                      color: 'var(--accent)',
                    }}
                  >
                    {currentIndex + 1}
                  </p>
                  <p className="text-label mt-1">
                    Step {String(currentIndex + 1).padStart(2, '0')} of {String(totalSteps).padStart(2, '0')}
                  </p>
                </div>
              </div>

              <p className="text-body t-muted leading-relaxed max-w-xl">
                {activeStep.description}
              </p>

              {activeStep.completed && activeStep.completedAt && (
                <p className="text-caption t-muted font-mono mt-3">
                  Completed {new Date(activeStep.completedAt).toLocaleDateString()}
                </p>
              )}

              {/* Remaining-step roster — light cards, mono labels */}
              {steps.some(s => !s.completed) && (
                <div className="mt-8">
                  <p className="text-label mb-3">Remaining milestones</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {steps.filter(s => !s.completed).map((step) => {
                      const idx = steps.findIndex(s => s.id === step.id);
                      const isActive = step.id === activeStep.id;
                      return (
                        <div
                          key={step.id}
                          className="rounded-md p-3 border flex items-center gap-3"
                          style={{
                            background: isActive ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                            borderColor: isActive ? 'rgb(var(--accent-rgb) / 0.30)' : 'var(--border-card)',
                          }}
                        >
                          <span
                            className="text-caption font-mono font-bold flex-shrink-0 w-7 text-center"
                            style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className={`text-body-sm truncate ${isActive ? 't-primary font-semibold' : 't-muted'}`}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action bar — primary CTA + mark-done, mockup footer */}
              {!activeStep.completed && activeTarget && (
                <div className="flex flex-wrap items-center gap-3 mt-auto pt-8">
                  <Button
                    variant="primary"
                    onClick={() => navigate(activeTarget.route)}
                  >
                    {activeTarget.cta} <ArrowRight size={14} className="ml-1" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => markComplete(activeStep.id)}
                    disabled={completing === activeStep.id}
                  >
                    {completing === activeStep.id ? (
                      <><Loader2 size={14} className="mr-1 animate-spin" /> Marking…</>
                    ) : (
                      <>I&apos;ve done this</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="text-caption t-muted text-center pt-8">
        Need help? File a ticket at <a href="/support-tickets" className="text-accent hover:underline">/support-tickets</a> or
        ping your CS engineer in your shared Slack channel.
      </div>
    </div>
  );
}

export default OnboardingWizardPage;
