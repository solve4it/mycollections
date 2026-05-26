export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthProvider {
  signIn(credentials: AuthCredentials): Promise<AuthResult>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
}

export interface FeatureFlagProvider {
  isEnabled(key: string): boolean;
}

export interface ErrorReporter {
  capture(error: Error, context?: Record<string, unknown>): void;
}
