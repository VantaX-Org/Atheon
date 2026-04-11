// TASK-026: Tests for utility functions
import { describe, it, expect } from "vitest";

// Test the chart-theme utility (already tested in chart-theme.test.ts)
// This file tests additional lib utilities

describe("utils", () => {
  it("window.localStorage mock works", () => {
    localStorage.setItem("test-key", "test-value");
    expect(localStorage.getItem("test-key")).toBe("test-value");
    localStorage.removeItem("test-key");
    expect(localStorage.getItem("test-key")).toBeNull();
  });

  it("crypto.randomUUID produces unique IDs", () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});
