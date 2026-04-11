// TASK-026: Test for i18n framework
import { enMessages } from "../en";
import { afMessages } from "../af";
import { getMessages, SUPPORTED_LOCALES } from "../index";

describe("i18n", () => {
  it("exports English messages with required keys", () => {
    expect(enMessages["nav.dashboard"]).toBe("Dashboard");
    expect(enMessages["action.loading"]).toBe("Loading...");
    expect(enMessages["action.save"]).toBe("Save");
  });

  it("exports Afrikaans messages with required keys", () => {
    expect(afMessages["nav.dashboard"]).toBe("Kontroleskerm");
    expect(afMessages["action.loading"]).toBe("Laai...");
    expect(afMessages["action.save"]).toBe("Stoor");
  });

  it("getMessages returns English by default", async () => {
    const msgs = await getMessages("en");
    expect(msgs["nav.dashboard"]).toBe("Dashboard");
  });

  it("getMessages returns Afrikaans when requested", async () => {
    const msgs = await getMessages("af");
    expect(msgs["nav.dashboard"]).toBe("Kontroleskerm");
  });

  it("SUPPORTED_LOCALES contains en and af", () => {
    expect(SUPPORTED_LOCALES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "en" }),
        expect.objectContaining({ code: "af" }),
      ])
    );
  });

  it("en and af have same keys", () => {
    const enKeys = Object.keys(enMessages).sort();
    const afKeys = Object.keys(afMessages).sort();
    expect(enKeys).toEqual(afKeys);
  });
});
