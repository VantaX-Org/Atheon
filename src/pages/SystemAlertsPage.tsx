/**
 * ADMIN-012: System Alerts & Notification Rules
 * Alert rules engine with built-in alert types, channels, state management.
 * Route: /system-alerts | Role: admin, support_admin, superadmin
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  Bell, Plus, Trash2, CheckCircle, XCircle,
  AlertTriangle, Clock, Mail, Webhook,
  ToggleLeft, ToggleRight, Filter,
} from 'lucide-react';

type AlertSeverity = 'critical' | 'warning' | 'info';
type ChannelType = 'email' | 'webhook' | 'in_app';
type AlertState = 'firing' | 'resolved' | 'acknowledged' | 'silenced';

interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  severity: AlertSeverity;
  channels: ChannelType[];
  enabled: boolean;
  cooldownMinutes: number;
  createdAt: string;
  lastTriggered?: string;
  triggerCount: number;
}

interface AlertInstance {
  id: string;
  ruleName: string;
  severity: AlertSeverity;
  state: AlertState;
  message: string;
  firedAt: string;
  resolvedAt?: string;
  acknowledgedBy?: string;
}

interface NotificationChannel {
  id: string;
  name: string;
  type: ChannelType;
  config: string;
  enabled: boolean;
  lastUsed?: string;
}

export function SystemAlertsPage() {
  const { activeTab, setActiveTab } = useTabState('active');

  const [rules, setRules] = useState<AlertRule[]>([
    { id: '1', name: 'High Error Rate', description: 'Triggers when API error rate exceeds 5%', condition: 'error_rate > 5%', severity: 'critical', channels: ['email', 'webhook'], enabled: true, cooldownMinutes: 15, createdAt: new Date(Date.now() - 2592000000).toISOString(), lastTriggered: new Date(Date.now() - 604800000).toISOString(), triggerCount: 3 },
    { id: '2', name: 'Storage Quota Warning', description: 'Triggers when tenant storage exceeds 80%', condition: 'storage_used > 80%', severity: 'warning', channels: ['email', 'in_app'], enabled: true, cooldownMinutes: 60, createdAt: new Date(Date.now() - 1296000000).toISOString(), lastTriggered: new Date(Date.now() - 172800000).toISOString(), triggerCount: 7 },
    { id: '3', name: 'ERP Sync Failure', description: 'Triggers on 3 consecutive sync failures', condition: 'consecutive_sync_failures >= 3', severity: 'critical', channels: ['email', 'webhook', 'in_app'], enabled: true, cooldownMinutes: 30, createdAt: new Date(Date.now() - 604800000).toISOString(), lastTriggered: new Date(Date.now() - 86400000).toISOString(), triggerCount: 2 },
    { id: '4', name: 'New User Signup', description: 'Notification when a new user registers', condition: 'event == user_created', severity: 'info', channels: ['in_app'], enabled: false, cooldownMinutes: 0, createdAt: new Date(Date.now() - 2592000000).toISOString(), triggerCount: 45 },
    { id: '5', name: 'API Latency Spike', description: 'Triggers when p95 latency exceeds 500ms', condition: 'p95_latency > 500ms', severity: 'warning', channels: ['email'], enabled: true, cooldownMinutes: 30, createdAt: new Date(Date.now() - 1296000000).toISOString(), triggerCount: 12 },
  ]);

  const [alerts] = useState<AlertInstance[]>([
    { id: '1', ruleName: 'ERP Sync Failure', severity: 'critical', state: 'firing', message: 'Salesforce CRM: 5 consecutive sync failures detected', firedAt: new Date(Date.now() - 86400000).toISOString() },
    { id: '2', ruleName: 'Storage Quota Warning', severity: 'warning', state: 'acknowledged', message: 'Acme Corp storage at 87% (8.7GB/10GB)', firedAt: new Date(Date.now() - 172800000).toISOString(), acknowledgedBy: 'admin@atheon.io' },
    { id: '3', ruleName: 'High Error Rate', severity: 'critical', state: 'resolved', message: 'API error rate peaked at 7.2% for 5 minutes', firedAt: new Date(Date.now() - 604800000).toISOString(), resolvedAt: new Date(Date.now() - 603000000).toISOString() },
    { id: '4', ruleName: 'API Latency Spike', severity: 'warning', state: 'resolved', message: 'P95 latency reached 680ms due to D1 query backlog', firedAt: new Date(Date.now() - 432000000).toISOString(), resolvedAt: new Date(Date.now() - 430200000).toISOString() },
  ]);

  const [channels] = useState<NotificationChannel[]>([
    { id: '1', name: 'Admin Email', type: 'email', config: 'admin@company.com', enabled: true, lastUsed: new Date(Date.now() - 86400000).toISOString() },
    { id: '2', name: 'Ops Team Email', type: 'email', config: 'ops@company.com', enabled: true, lastUsed: new Date(Date.now() - 172800000).toISOString() },
    { id: '3', name: 'Slack Webhook', type: 'webhook', config: 'https://hooks.slack.com/services/...', enabled: true, lastUsed: new Date(Date.now() - 86400000).toISOString() },
    { id: '4', name: 'In-App Notifications', type: 'in_app', config: 'All admin users', enabled: true, lastUsed: new Date(Date.now() - 3600000).toISOString() },
  ]);

  const [showCreateRule, setShowCreateRule] = useState(false);

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const tabs = [
    { id: 'active', label: 'Active Alerts', icon: <AlertTriangle size={14} />, count: alerts.filter(a => a.state === 'firing').length },
    { id: 'rules', label: 'Alert Rules', icon: <Filter size={14} />, count: rules.length },
    { id: 'history', label: 'History', icon: <Clock size={14} /> },
    { id: 'channels', label: 'Channels', icon: <Bell size={14} />, count: channels.length },
  ];

  const severityColor = (s: AlertSeverity) => s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'info';
  const stateColor = (s: AlertState) => s === 'firing' ? 'danger' : s === 'acknowledged' ? 'warning' : s === 'resolved' ? 'success' : 'default';
  const stateIcon = (s: AlertState) => {
    if (s === 'firing') return <XCircle size={14} className="text-red-400 animate-pulse" />;
    if (s === 'acknowledged') return <Clock size={14} className="text-amber-400" />;
    if (s === 'resolved') return <CheckCircle size={14} className="text-emerald-400" />;
    return <Bell size={14} className="t-muted" />;
  };
  const channelIcon = (t: ChannelType) => {
    if (t === 'email') return <Mail size={12} />;
    if (t === 'webhook') return <Webhook size={12} />;
    return <Bell size={12} />;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Bell className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">System Alerts</h1>
            <p className="text-xs t-muted">Alert rules, notification channels, and incident management</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreateRule(true)}>
          <Plus size={14} className="mr-1" /> New Rule
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Firing</p>
          <p className="text-xl font-bold text-red-400">{alerts.filter(a => a.state === 'firing').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Acknowledged</p>
          <p className="text-xl font-bold text-amber-400">{alerts.filter(a => a.state === 'acknowledged').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Active Rules</p>
          <p className="text-xl font-bold t-primary">{rules.filter(r => r.enabled).length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Channels</p>
          <p className="text-xl font-bold t-primary">{channels.filter(c => c.enabled).length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="active" activeTab={activeTab}>
        <div className="space-y-2">
          {alerts.filter(a => a.state !== 'resolved').length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm t-muted">No active alerts</p>
            </Card>
          ) : alerts.filter(a => a.state !== 'resolved').map(a => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start gap-3">
                {stateIcon(a.state)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{a.ruleName}</p>
                    <Badge variant={severityColor(a.severity)} className="text-[10px]">{a.severity}</Badge>
                    <Badge variant={stateColor(a.state)} className="text-[10px]">{a.state}</Badge>
                  </div>
                  <p className="text-xs t-muted mt-0.5">{a.message}</p>
                  <p className="text-[10px] t-muted mt-1">
                    Fired: {new Date(a.firedAt).toLocaleString()}
                    {a.acknowledgedBy && ` · Acknowledged by: ${a.acknowledgedBy}`}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="rules" activeTab={activeTab}>
        <div className="space-y-2">
          {rules.map(r => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleRule(r.id)} className="mt-0.5">
                    {r.enabled ? <ToggleRight size={20} className="text-emerald-400" /> : <ToggleLeft size={20} className="t-muted" />}
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium t-primary">{r.name}</p>
                      <Badge variant={severityColor(r.severity)} className="text-[10px]">{r.severity}</Badge>
                    </div>
                    <p className="text-xs t-muted mt-0.5">{r.description}</p>
                    <p className="text-[10px] font-mono t-muted mt-1 p-1 rounded bg-[var(--bg-secondary)] inline-block">{r.condition}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] t-muted">Channels:</span>
                      {r.channels.map(ch => (
                        <span key={ch} className="text-[10px] t-muted flex items-center gap-0.5">{channelIcon(ch)} {ch}</span>
                      ))}
                      <span className="text-[10px] t-muted">· Cooldown: {r.cooldownMinutes}min · Triggered {r.triggerCount}x</span>
                    </div>
                  </div>
                </div>
                <button className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="history" activeTab={activeTab}>
        <div className="space-y-2">
          {alerts.map(a => (
            <Card key={a.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {stateIcon(a.state)}
                <div>
                  <p className="text-sm font-medium t-primary">{a.ruleName}</p>
                  <p className="text-[10px] t-muted">{a.message}</p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant={stateColor(a.state)} className="text-[10px]">{a.state}</Badge>
                <p className="text-[10px] t-muted mt-1">{new Date(a.firedAt).toLocaleString()}</p>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="channels" activeTab={activeTab}>
        <div className="space-y-2">
          {channels.map(ch => (
            <Card key={ch.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                  {channelIcon(ch.type)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{ch.name}</p>
                    <Badge variant="default" className="text-[10px]">{ch.type}</Badge>
                  </div>
                  <p className="text-[10px] t-muted">{ch.config}</p>
                  {ch.lastUsed && <p className="text-[10px] t-muted">Last used: {new Date(ch.lastUsed).toLocaleString()}</p>}
                </div>
              </div>
              <Badge variant={ch.enabled ? 'success' : 'default'} className="text-[10px]">{ch.enabled ? 'active' : 'disabled'}</Badge>
            </Card>
          ))}
        </div>
      </TabPanel>

      {/* Create Rule Modal */}
      {showCreateRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateRule(false)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-4">Create Alert Rule</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Rule Name</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" placeholder="e.g., High CPU Usage" />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Condition</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary font-mono" placeholder="e.g., cpu_usage > 90%" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Severity</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary">
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Cooldown (min)</label>
                  <input type="number" className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" defaultValue={15} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowCreateRule(false)} className="flex-1">Cancel</Button>
              <Button onClick={() => setShowCreateRule(false)} className="flex-1">
                <Plus size={14} className="mr-1" /> Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
