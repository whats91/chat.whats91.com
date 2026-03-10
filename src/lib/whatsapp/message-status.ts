export const MESSAGE_STATUS_CODE_BY_KEY = {
  read: 100,
  delivered: 90,
  failed: 80,
  ecosystem_limited: 80,
  notonwa: 80,
  spam_rate_limited: 80,
  pair_rate_limited: 80,
  rate_limited: 80,
  offline: 80,
  undelivered: 80,
  badfile: 80,
  sent: 50,
  accepted: 30,
  processing: 20,
  pending: 10,
  queued: 5,
  scheduled: 3,
} as const;

export const MESSAGE_STATUS_LABEL_BY_KEY: Record<string, string> = {
  read: 'Read',
  delivered: 'Delivered',
  failed: 'Failed',
  ecosystem_limited: 'Ecosystem Limited',
  notonwa: 'Not on WhatsApp',
  spam_rate_limited: 'Spam Rate Limited',
  pair_rate_limited: 'Pair Rate Limited',
  rate_limited: 'Rate Limited',
  offline: 'Offline',
  undelivered: 'Undelivered',
  badfile: 'Bad File',
  sent: 'Sent',
  accepted: 'Accepted',
  processing: 'Processing',
  pending: 'Pending',
  queued: 'Queued',
  scheduled: 'Scheduled',
};

export const CANONICAL_MESSAGE_STATUS_KEY_BY_CODE: Record<number, string> = {
  100: 'read',
  90: 'delivered',
  80: 'ecosystem_limited',
  50: 'sent',
  30: 'accepted',
  20: 'processing',
  10: 'pending',
  5: 'queued',
  3: 'scheduled',
};

export const META_ERROR_CODE_TO_MESSAGE_STATUS_KEY: Record<number, string> = {
  131049: 'ecosystem_limited',
  131048: 'spam_rate_limited',
  131056: 'pair_rate_limited',
  4: 'rate_limited',
  80007: 'rate_limited',
  130429: 'rate_limited',
  2: 'offline',
  131000: 'offline',
  131026: 'notonwa',
};

type ResolveMessageStatusInput = {
  status?: string | null;
  code?: string | number | null;
  errorCode?: string | number | null;
};

function toNumericCode(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeStatusKey(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || null;
}

function fallbackStatusLabel(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getMessageStatusCode(status: string | null | undefined): number {
  const normalizedStatus = normalizeStatusKey(status);
  if (!normalizedStatus) {
    return 0;
  }

  return MESSAGE_STATUS_CODE_BY_KEY[
    normalizedStatus as keyof typeof MESSAGE_STATUS_CODE_BY_KEY
  ] || 0;
}

export function getMessageStatusLabel(statusOrCode: string | number | null | undefined): string {
  if (typeof statusOrCode === 'number' && Number.isFinite(statusOrCode)) {
    const canonicalStatus = CANONICAL_MESSAGE_STATUS_KEY_BY_CODE[statusOrCode];
    return canonicalStatus
      ? MESSAGE_STATUS_LABEL_BY_KEY[canonicalStatus] || fallbackStatusLabel(canonicalStatus)
      : `Status ${statusOrCode}`;
  }

  const numericCode = toNumericCode(statusOrCode);
  if (numericCode !== null && String(statusOrCode).trim() === String(numericCode)) {
    return getMessageStatusLabel(numericCode);
  }

  const normalizedStatus =
    typeof statusOrCode === 'string' ? normalizeStatusKey(statusOrCode) : null;
  if (!normalizedStatus) {
    return 'Unknown';
  }

  return (
    MESSAGE_STATUS_LABEL_BY_KEY[normalizedStatus] ||
    fallbackStatusLabel(normalizedStatus)
  );
}

export function resolveMessageStatusDetails(input: ResolveMessageStatusInput): {
  key: string;
  code: number;
  label: string;
} {
  const numericErrorCode = toNumericCode(input.errorCode);
  const numericCode = toNumericCode(input.code);
  let resolvedKey = normalizeStatusKey(input.status);

  if (
    numericErrorCode !== null &&
    (!resolvedKey || resolvedKey === 'failed') &&
    META_ERROR_CODE_TO_MESSAGE_STATUS_KEY[numericErrorCode]
  ) {
    resolvedKey = META_ERROR_CODE_TO_MESSAGE_STATUS_KEY[numericErrorCode];
  }

  if (!resolvedKey && numericCode !== null) {
    resolvedKey = CANONICAL_MESSAGE_STATUS_KEY_BY_CODE[numericCode] || null;
  }

  if (!resolvedKey) {
    resolvedKey = 'failed';
  }

  return {
    key: resolvedKey,
    code: getMessageStatusCode(resolvedKey),
    label: getMessageStatusLabel(resolvedKey),
  };
}
