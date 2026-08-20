export type CredentialValidation =
  | { valid: true; email: string; password: string }
  | { valid: false; message: string };

export function validateHostCredentials(
  emailInput: string,
  passwordInput: string,
): CredentialValidation {
  const email = emailInput.trim().toLowerCase();
  const password = passwordInput;

  if (!email || !email.includes("@") || !email.includes(".")) {
    return { valid: false, message: "Enter a valid email address." };
  }

  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters.",
    };
  }

  return { valid: true, email, password };
}
