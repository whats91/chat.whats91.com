const IST_TIME_ZONE = 'Asia/Kolkata';

const istDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const istTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function getIstDayParts(value: Date | string | number): { year: number; month: number; day: number } {
  const date = toDate(value);
  const parts = istDayFormatter.formatToParts(date);

  const year = Number(parts.find((part) => part.type === 'year')?.value || '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0');
  const day = Number(parts.find((part) => part.type === 'day')?.value || '0');

  return { year, month, day };
}

function getIstDayValue(value: Date | string | number): number {
  const parts = getIstDayParts(value);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

export function formatTimeInIst(value: Date | string | number): string {
  return istTimeFormatter.format(toDate(value));
}

export function formatDateInIst(value: Date | string | number): string {
  return istDateFormatter.format(toDate(value));
}

export function formatDateHeaderInIst(
  value: Date | string | number,
  referenceDate: Date | string | number = new Date()
): string {
  const dayValue = getIstDayValue(value);
  const referenceDayValue = getIstDayValue(referenceDate);

  if (dayValue === referenceDayValue) {
    return 'Today';
  }

  if (dayValue === referenceDayValue - 1) {
    return 'Yesterday';
  }

  return formatDateInIst(value);
}

export function getIstDateKey(value: Date | string | number): string {
  const parts = getIstDayParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function isSameIstDay(
  left: Date | string | number,
  right: Date | string | number
): boolean {
  return getIstDateKey(left) === getIstDateKey(right);
}

export { IST_TIME_ZONE };
