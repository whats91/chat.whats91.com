import type {
  AuthMutationResponse,
  AuthSessionResponse,
  OtpLoginRequest,
  OtpLoginVerifyRequest,
  PasswordLoginRequest,
} from '@/lib/types/auth';

const AUTH_API_BASE = '/api/auth';

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${AUTH_API_BASE}/csrf`, {
    method: 'GET',
    cache: 'no-store',
  });
  const payload = await parseJson<{ success: boolean; token: string }>(response);
  return payload.token;
}

export async function fetchAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch(`${AUTH_API_BASE}/session`, {
    method: 'GET',
    cache: 'no-store',
  });
  return parseJson<AuthSessionResponse>(response);
}

export async function loginWithPassword(
  payload: PasswordLoginRequest,
  csrfToken: string
): Promise<AuthMutationResponse> {
  const response = await fetch(`${AUTH_API_BASE}/login/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(payload),
  });
  return parseJson<AuthMutationResponse>(response);
}

export async function requestOtpLogin(
  payload: OtpLoginRequest,
  csrfToken: string
): Promise<AuthMutationResponse> {
  const response = await fetch(`${AUTH_API_BASE}/login/otp/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(payload),
  });
  return parseJson<AuthMutationResponse>(response);
}

export async function verifyOtpLogin(
  payload: OtpLoginVerifyRequest,
  csrfToken: string
): Promise<AuthMutationResponse> {
  const response = await fetch(`${AUTH_API_BASE}/login/otp/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(payload),
  });
  return parseJson<AuthMutationResponse>(response);
}

export async function logout(csrfToken: string): Promise<AuthMutationResponse> {
  const response = await fetch(`${AUTH_API_BASE}/session`, {
    method: 'DELETE',
    headers: {
      'x-csrf-token': csrfToken,
    },
  });
  return parseJson<AuthMutationResponse>(response);
}

