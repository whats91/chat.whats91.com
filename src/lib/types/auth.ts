export interface AuthenticatedUser {
  id: string;
  adminId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  type: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthenticatedUser | null;
}

export interface PasswordLoginRequest {
  identifier: string;
  password: string;
}

export interface OtpLoginRequest {
  phone: string;
}

export interface OtpLoginVerifyRequest {
  phone: string;
  otp: string;
}

export interface AuthMutationResponse {
  success: boolean;
  message: string;
  user?: AuthenticatedUser;
  data?: Record<string, unknown> | null;
}
