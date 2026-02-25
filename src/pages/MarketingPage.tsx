import { useNavigate } from "react-router-dom";
import { Hero3D, AtheonLogoInline } from "@/components/common/Hero3D";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Shield, Brain, Zap, BarChart3, Globe, Layers,
  Lock, Activity, Database, Cloud, Users, CheckCircle2,
  Cpu, Network, FileText, ChevronRight,
} from "lucide-react";

const SERIF = "Georgia, 'Times New Roman', serif";

/* ── Feature data ── */
const platformLayers = [
  {
    icon: BarChart3,
    title: 'Atheon Apex',
    subtitle: 'Executive Intelligence',
    description: 'Real-time health scoring across financial, operational, and strategic dimensions. AI-generated briefings distill thousands of data points into actionable executive summaries.',
    highlights: ['Health Score Engine', 'Strategic Briefings', 'Decision Queue', 'Opportunity Detection'],
    color: '#e8a000',
  },
  {
    icon: Activity,
    title: 'Atheon Pulse',
    subtitle: 'Process Monitoring',
    description: 'Continuous monitoring of business processes with intelligent anomaly detection. Real-time KPIs, trend analysis, and automated exception highlighting.',
    highlights: ['Live KPI Dashboards', 'Anomaly Detection', 'Trend Analysis', 'Exception Alerts'],
    color: '#2563eb',
  },
  {
    icon: Zap,
    title: 'Atheon Catalysts',
    subtitle: 'Autonomous Execution',
    description: 'AI-powered autonomous workers that execute tasks, remediate issues, and optimize processes. Configurable approval workflows and audit trails.',
    highlights: ['Auto-Remediation', 'Approval Workflows', 'Task Scheduling', 'Execution Logs'],
    color: '#059669',
  },
  {
    icon: Brain,
    title: 'Atheon Mind',
    subtitle: 'Domain LLM Engine',
    description: 'Proprietary domain-specific language models trained on your industry data. Multi-tier inference with intelligent routing for optimal cost and performance.',
    highlights: ['Industry Models', 'Multi-tier Inference', 'RAG Pipeline', 'Model Fine-tuning'],
    color: '#7c3aed',
  },
  {
    icon: Database,
    title: 'Atheon Memory',
    subtitle: 'Knowledge Layer',
    description: 'Vector-powered semantic search across all enterprise documents. Persistent memory that learns from every interaction and decision.',
    highlights: ['Semantic Search', 'Document Indexing', 'Knowledge Graph', 'Context Retention'],
    color: '#0284c7',
  },
  {
    icon: Network,
    title: 'ERP Integration',
    subtitle: 'Universal Adapter Layer',
    description: 'Pre-built adapters for SAP, Xero, Sage, Pastel and more. Canonical API translates between ERP-specific schemas and Atheon\'s unified data model.',
    highlights: ['SAP Adapter', 'Xero / Sage / Pastel', 'Canonical API', 'Real-time Sync'],
    color: '#e11d48',
  },
];

const deploymentModels = [
  { icon: Cloud, title: 'SaaS', description: 'Fully managed cloud deployment. Zero infrastructure overhead with automatic updates and scaling.' },
  { icon: Shield, title: 'On-Premise', description: 'Deploy within your data center. Complete data sovereignty with air-gapped operation support.' },
  { icon: Layers, title: 'Hybrid', description: 'Best of both worlds. Keep sensitive data on-premise while leveraging cloud AI capabilities.' },
];

const securityFeatures = [
  'SOC 2 Type II compliant architecture',
  'End-to-end encryption at rest and in transit',
  'PBKDF2 password hashing with Web Crypto API',
  'JWT token blacklisting and session management',
  'Role-based access control (RBAC)',
  'Complete audit trail for every action',
  'Azure AD / SAML SSO integration',
  'Tenant-level data isolation',
];

const stats = [
  { value: '6', label: 'Intelligence Layers' },
  { value: '5+', label: 'ERP Adapters' },
  { value: '3', label: 'Deployment Models' },
  { value: '24/7', label: 'Autonomous Monitoring' },
];

export function MarketingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: '#fafaf8' }}>
      {/* ═══ NAVBAR ═══ */}
      <nav className="sticky top-0 z-50 backdrop-blur-md border-b" style={{ background: 'rgba(250, 250, 248, 0.92)', borderColor: 'rgba(0,0,0,0.06)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-1">
            <AtheonLogoInline className="text-3xl" />
            <span className="text-2xl font-bold" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>theon</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm" style={{ color: '#666' }}>
            <a href="#features" className="hover:text-[#1a1a1a] transition-colors">Features</a>
            <a href="#platform" className="hover:text-[#1a1a1a] transition-colors">Platform</a>
            <a href="#deployment" className="hover:text-[#1a1a1a] transition-colors">Deployment</a>
            <a href="#security" className="hover:text-[#1a1a1a] transition-colors">Security</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} className="text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-80" style={{ color: '#1a1a1a' }}>
              Sign In
            </button>
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>
              Get Started <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_center,rgba(232,160,0,0.06),transparent_60%)]" />
        <div className="max-w-7xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          <div className="flex-1 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
              style={{ background: 'rgba(232, 160, 0, 0.08)', color: '#e8a000', border: '1px solid rgba(232, 160, 0, 0.15)' }}
            >
              <Zap size={12} /> Enterprise Intelligence Platform
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
              AI-powered intelligence for the{' '}
              <span style={{ color: '#e8a000' }}>modern enterprise</span>
            </h1>
            <p className="text-lg lg:text-xl leading-relaxed mb-8 max-w-xl" style={{ color: '#666' }}>
              From executive health scoring to autonomous execution, Atheon transforms raw ERP data into strategic advantage. Six intelligent layers working as one.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button variant="primary" size="lg" onClick={() => navigate('/login')}>
                Start Free Trial <ArrowRight size={16} />
              </Button>
              <button onClick={() => document.getElementById('platform')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ border: '1px solid rgba(0,0,0,0.1)', color: '#1a1a1a' }}
              >
                Explore Platform <ChevronRight size={14} />
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-14 pt-8" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              {stats.map(s => (
                <div key={s.label}>
                  <div className="text-2xl font-bold" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{s.value}</div>
                  <div className="text-xs mt-1" style={{ color: '#999' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero 3D */}
          <div className="flex-shrink-0 relative">
            <div className="absolute -inset-10 bg-[radial-gradient(ellipse_at_center,rgba(249,115,22,0.12),transparent_65%)]" />
            <Hero3D size="lg" />
          </div>
        </div>
      </section>

      {/* ═══ TRUSTED BY ═══ */}
      <section className="py-12 border-y" style={{ borderColor: 'rgba(0,0,0,0.04)', background: '#f5f5f0' }}>
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs uppercase tracking-widest mb-6" style={{ color: '#999' }}>Built for enterprise. Trusted by industry leaders.</p>
          <div className="flex items-center justify-center gap-12 flex-wrap opacity-40">
            {['Manufacturing', 'Retail', 'Mining', 'Healthcare', 'Financial Services'].map(i => (
              <span key={i} className="text-sm font-medium" style={{ color: '#666' }}>{i}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PLATFORM LAYERS ═══ */}
      <section id="platform" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
              Six layers of intelligence
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: '#666' }}>
              Each layer works independently and as part of a unified system, delivering end-to-end enterprise intelligence from data ingestion to autonomous action.
            </p>
          </div>

          <div id="features" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platformLayers.map((layer, idx) => {
              const Icon = layer.icon;
              const isBlack = idx === 0 || idx === 3; // Apex and Mind get black cards
              const isMint = idx === 2; // Catalysts gets mint
              return (
                <div
                  key={layer.title}
                  className="rounded-2xl p-6 transition-all hover:-translate-y-1"
                  style={
                    isBlack
                      ? { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)' }
                      : isMint
                      ? { background: '#f0f8f0', border: '1px solid rgba(34,150,34,0.1)' }
                      : { background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
                  }
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: `${layer.color}15` }}
                  >
                    <Icon size={20} style={{ color: layer.color }} />
                  </div>
                  <h3 className="text-lg font-bold mb-1" style={{ fontFamily: SERIF, color: isBlack ? '#f0f0f2' : '#1a1a1a' }}>
                    {layer.title}
                  </h3>
                  <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: layer.color }}>
                    {layer.subtitle}
                  </p>
                  <p className="text-sm leading-relaxed mb-4" style={{ color: isBlack ? '#a0a0b0' : '#666' }}>
                    {layer.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {layer.highlights.map(h => (
                      <span key={h} className="text-xs px-2 py-1 rounded-md" style={{
                        background: isBlack ? 'rgba(255,255,255,0.06)' : isMint ? 'rgba(34,150,34,0.08)' : 'rgba(0,0,0,0.03)',
                        color: isBlack ? '#ccc' : isMint ? '#2d7d2d' : '#888'
                      }}>
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="py-20 lg:py-28" style={{ background: '#f5f5f0' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
              From data to decision in seconds
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: '#666' }}>
              Atheon connects to your existing ERP systems, processes data through AI models, and delivers actionable intelligence to the right people at the right time.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: '01', title: 'Connect', desc: 'Plug in your ERP systems through pre-built adapters. SAP, Xero, Sage, Pastel and more.', icon: Globe },
              { step: '02', title: 'Analyze', desc: 'AI models process transactions, detect anomalies, and score organizational health in real-time.', icon: Cpu },
              { step: '03', title: 'Decide', desc: 'Executive briefings and decision queues surface what matters most. AI recommends actions.', icon: FileText },
              { step: '04', title: 'Execute', desc: 'Catalysts autonomously execute approved actions. Full audit trail for compliance.', icon: Zap },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.step} className="text-center">
                  <div className="text-5xl font-bold mb-4" style={{ fontFamily: SERIF, color: 'rgba(232,160,0,0.15)' }}>{s.step}</div>
                  <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(232,160,0,0.08)' }}>
                    <Icon size={22} style={{ color: '#e8a000' }} />
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{s.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: '#666' }}>{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ DEPLOYMENT MODELS ═══ */}
      <section id="deployment" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
              Deploy your way
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: '#666' }}>
              Choose the deployment model that fits your security requirements and infrastructure strategy.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {deploymentModels.map((m, i) => {
              const Icon = m.icon;
              const isCenter = i === 1;
              return (
                <div key={m.title} className="rounded-2xl p-8 text-center transition-all hover:-translate-y-1"
                  style={isCenter
                    ? { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)' }
                    : { background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }
                  }
                >
                  <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center"
                    style={{ background: isCenter ? 'rgba(232,160,0,0.15)' : 'rgba(232,160,0,0.08)' }}
                  >
                    <Icon size={24} style={{ color: '#e8a000' }} />
                  </div>
                  <h3 className="text-xl font-bold mb-3" style={{ fontFamily: SERIF, color: isCenter ? '#f0f0f2' : '#1a1a1a' }}>
                    {m.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: isCenter ? '#a0a0b0' : '#666' }}>
                    {m.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ MULTI-TENANT ═══ */}
      <section className="py-20 lg:py-28" style={{ background: '#f5f5f0' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <div className="flex-1">
              <h2 className="text-3xl sm:text-4xl font-bold mb-6" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
                Multi-tenant by design
              </h2>
              <p className="text-lg leading-relaxed mb-8" style={{ color: '#666' }}>
                Each client gets a fully isolated environment with granular control over which features and catalysts they can deploy. Manage hundreds of tenants from a single control plane.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Users, text: 'Client-level feature entitlements and access control' },
                  { icon: Lock, text: 'Tenant-isolated data with encryption at rest' },
                  { icon: Layers, text: 'Per-tenant deployment model (SaaS, on-premise, hybrid)' },
                  { icon: Activity, text: 'Centralized monitoring with per-tenant health dashboards' },
                ].map(f => {
                  const Icon = f.icon;
                  return (
                    <div key={f.text} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(232,160,0,0.08)' }}>
                        <Icon size={16} style={{ color: '#e8a000' }} />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: '#444' }}>{f.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4">
              {[
                { label: 'Tenants', value: 'Unlimited', sub: 'Fully isolated' },
                { label: 'Users per tenant', value: 'Unlimited', sub: 'RBAC enforced' },
                { label: 'ERP connections', value: '5+', sub: 'Pre-built adapters' },
                { label: 'Uptime SLA', value: '99.9%', sub: 'Enterprise grade' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl p-5" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)' }}>
                  <div className="text-2xl font-bold mb-1" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>{s.value}</div>
                  <div className="text-sm font-medium mb-0.5" style={{ color: '#1a1a1a' }}>{s.label}</div>
                  <div className="text-xs" style={{ color: '#999' }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECURITY ═══ */}
      <section id="security" className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="rounded-3xl p-10 lg:p-16" style={{ background: '#1a1a1a' }}>
            <div className="flex flex-col lg:flex-row items-start gap-12">
              <div className="flex-1">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: 'rgba(232,160,0,0.15)' }}>
                  <Shield size={24} style={{ color: '#e8a000' }} />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ fontFamily: SERIF, color: '#f0f0f2' }}>
                  Enterprise-grade security
                </h2>
                <p className="text-base leading-relaxed" style={{ color: '#a0a0b0' }}>
                  Security isn't an afterthought. Every layer of the Atheon platform is built with zero-trust principles, end-to-end encryption, and comprehensive audit logging.
                </p>
              </div>
              <div className="flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {securityFeatures.map(f => (
                    <div key={f} className="flex items-start gap-2">
                      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#e8a000' }} />
                      <span className="text-sm" style={{ color: '#ccc' }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="py-20 lg:py-28" style={{ background: '#f5f5f0' }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>
            Ready to transform your enterprise?
          </h2>
          <p className="text-lg mb-10" style={{ color: '#666' }}>
            Join industry leaders who use Atheon to turn operational data into strategic advantage.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" size="lg" onClick={() => navigate('/login')}>
              Start Free Trial <ArrowRight size={16} />
            </Button>
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all hover:opacity-80"
              style={{ border: '1px solid rgba(0,0,0,0.1)', color: '#1a1a1a' }}
            >
              Contact Sales
            </button>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-12 border-t" style={{ borderColor: 'rgba(0,0,0,0.06)', background: '#fafaf8' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-baseline gap-1">
              <AtheonLogoInline className="text-2xl" />
              <span className="text-xl font-bold" style={{ fontFamily: SERIF, color: '#1a1a1a' }}>theon</span>
            </div>
            <div className="flex items-center gap-8 text-sm" style={{ color: '#999' }}>
              <a href="#features" className="hover:text-[#1a1a1a] transition-colors">Features</a>
              <a href="#platform" className="hover:text-[#1a1a1a] transition-colors">Platform</a>
              <a href="#security" className="hover:text-[#1a1a1a] transition-colors">Security</a>
              <span>&copy; {new Date().getFullYear()} Atheon</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
