// TASK-026: Tests for appStore (Zustand state management)
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";

describe('theme (light | dark | auto)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('setTheme stamps data-theme on <html> and persists', () => {
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('atheon-theme')).toBe('dark');

    useAppStore.getState().setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it("auto resolves to a concrete data-theme (never leaves 'auto' on <html>)", () => {
    useAppStore.getState().setTheme('auto');
    expect(useAppStore.getState().theme).toBe('auto');
    expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'));
  });

  it('toggleTheme cycles light → dark → auto', () => {
    useAppStore.getState().setTheme('light');
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('auto');
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('light');
  });
});

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({ user: null });
  });

  it("initializes with null user", () => {
    const state = useAppStore.getState();
    expect(state.user).toBeNull();
  });

  it("initializes with default theme", () => {
    const state = useAppStore.getState();
    expect(["dark", "light", "auto"]).toContain(state.theme);
  });

  it("initializes with default accent color", () => {
    const state = useAppStore.getState();
    expect(["indigo", "blue", "violet", "emerald", "rose"]).toContain(state.accentColor);
  });

  it("sets and clears user", () => {
    const mockUser = { id: "u1", email: "test@test.com", name: "Test", role: "admin" as const, tenantId: "t1" };
    useAppStore.getState().setUser(mockUser);
    expect(useAppStore.getState().user).toEqual(mockUser);

    useAppStore.getState().setUser(null);
    expect(useAppStore.getState().user).toBeNull();
  });

  it("toggles sidebar", () => {
    const initial = useAppStore.getState().sidebarOpen;
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(!initial);
  });

  it("sets current layer", () => {
    useAppStore.getState().setCurrentLayer("pulse");
    expect(useAppStore.getState().currentLayer).toBe("pulse");
  });

  it("dismisses onboarding", () => {
    useAppStore.getState().dismissOnboarding();
    expect(useAppStore.getState().onboardingDismissed).toBe(true);
  });

  it("sets active tenant", () => {
    useAppStore.getState().setActiveTenant("t1", "Test Tenant", "manufacturing");
    expect(useAppStore.getState().activeTenantId).toBe("t1");
    expect(useAppStore.getState().activeTenantName).toBe("Test Tenant");
    expect(useAppStore.getState().activeTenantIndustry).toBe("manufacturing");
  });
});
