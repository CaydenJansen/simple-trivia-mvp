import { describe, expect, it } from "vitest";

import { validateHostCredentials } from "./credentials";

describe("validateHostCredentials", () => {
  it("normalizes a valid email address", () => {
    expect(validateHostCredentials(" Host@Example.COM ", "password1")).toEqual({
      valid: true,
      email: "host@example.com",
      password: "password1",
    });
  });

  it("rejects an invalid email address", () => {
    expect(validateHostCredentials("host", "password1")).toEqual({
      valid: false,
      message: "Enter a valid email address.",
    });
  });

  it("rejects a short password", () => {
    expect(validateHostCredentials("host@example.com", "short")).toEqual({
      valid: false,
      message: "Password must be at least 8 characters.",
    });
  });
});
