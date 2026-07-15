import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import type { PersonaInsightsResponse } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      insights: { get: vi.fn() },
      auth: { ...orig.api.auth, setPersona: vi.fn() },
    },
  };
});

import { PersonaRail } from '@/components/journey/PersonaRail';
import { api } from '@/lib/api';
import type { User } from '@/types';

const insight = (over: Partial<PersonaInsightsResponse['insights'][number]> = {}) => ({
  id: 'i1',
  persona: 'cfo' as const,
  severity: 'high' as const,
  headline: 'AR at risk',
  detail: 'R2.4M in overdue receivables past 90 days',
  value_zar: 2400000,
  value_kind: 'confirmed' as const,
  source: { finding_code: 'AR-001', assessment_id: 'a1' },
  cta: { label: 'View findings', route: '/findings' },
  ...over,
});

const response = (over: Partial<PersonaInsightsResponse> = {}): PersonaInsightsResponse => ({
  persona: 'cfo',
  generated_from_assessment_id: 'a1',
  insights: [insight()],
  external_pulse: null,
  ...over,
});

const user = (over: Partial<User> = {}): User =>
  ({ id: 'u1', name: 'Test', email: 't@x.com', role: 'executive', persona: 'cfo', ...over }) as User;

describe('PersonaRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ user: user() as never });
  });

  it('renders insights from the API for the saved persona', async () => {
    vi.mocked(api.insights.get).mockResolvedValue(response());
    render(<MemoryRouter><PersonaRail user={user()} /></MemoryRouter>);
    expect(await screen.findByText('AR at risk')).toBeInTheDocument();
    expect(api.insights.get).toHaveBeenCalledWith('cfo');
    expect(screen.getByText('View findings')).toBeInTheDocument();
  });

  it('collapses to a quiet line on fetch error', async () => {
    vi.mocked(api.insights.get).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><PersonaRail user={user()} /></MemoryRouter>);
    expect(await screen.findByText("Insights couldn't be loaded right now.")).toBeInTheDocument();
  });

  it('renders nothing for a viewer', () => {
    vi.mocked(api.insights.get).mockResolvedValue(response());
    const { container } = render(
      <MemoryRouter><PersonaRail user={user({ role: 'viewer', persona: null })} /></MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(api.insights.get).not.toHaveBeenCalled();
  });

  it('fixed CEO rail hides the picker and caps at 5 cards', async () => {
    const many = Array.from({ length: 7 }, (_, n) =>
      insight({ id: `i${n}`, persona: 'ceo', headline: `Insight ${n}` }));
    vi.mocked(api.insights.get).mockResolvedValue(response({ persona: 'ceo', insights: many }));
    render(<MemoryRouter><PersonaRail user={user()} fixedPersona="ceo" /></MemoryRouter>);
    expect(await screen.findByText('Insight 0')).toBeInTheDocument();
    expect(api.insights.get).toHaveBeenCalledWith('ceo');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Set as my default')).not.toBeInTheDocument();
    expect(screen.getByTestId('persona-insights').children).toHaveLength(5);
  });
});
