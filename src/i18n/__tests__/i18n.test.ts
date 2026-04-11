// TASK-026: Test for i18n framework
import { t, getLocale, setLocale } from "../index";

describe("i18n", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("returns English translations by default", () => {
    expect(getLocale()).toBe("en");
    expect(t("common.loading")).toBe("Loading...");
    expect(t("common.save")).toBe("Save");
  });

  it("switches to Afrikaans", () => {
    setLocale("af");
    expect(getLocale()).toBe("af");
    expect(t("common.loading")).toBe("Laai...");
    expect(t("common.save")).toBe("Stoor");
  });

  it("falls back to key for missing translations", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("translates nav items", () => {
    expect(t("nav.dashboard")).toBe("Dashboard");
    setLocale("af");
    expect(t("nav.dashboard")).toBe("Kontroleskerm");
  });
});
