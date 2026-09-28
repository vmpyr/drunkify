interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTime extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

const localFormatters = new Map<string, Intl.DateTimeFormat>();

function localDateTime(instantMs: number, timezone: string): LocalDateTime {
  let formatter = localFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    localFormatters.set(timezone, formatter);
  }
  const values = Object.fromEntries(
    formatter
      .formatToParts(instantMs)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

function shiftedDate(instantMs: number, timezone: string): CalendarDate {
  const local = localDateTime(instantMs, timezone);
  const shifted = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour - 6, local.minute, local.second),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseDate(value: string): CalendarDate {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

function epochDay(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function timezoneOffsetMs(instantMs: number, timezone: string): number {
  const local = localDateTime(instantMs, timezone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return localAsUtc - Math.floor(instantMs / 1000) * 1000;
}

export function tripStartMs(startDate: string, timezone: string): number {
  const date = parseDate(startDate);
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // Two passes: the offset in effect at local midnight can differ from the one
  // at the naive UTC guess across a DST transition, so re-resolve once.
  const firstGuess = utcMidnight - timezoneOffsetMs(utcMidnight, timezone);
  return utcMidnight - timezoneOffsetMs(firstGuess, timezone);
}

export function tripLengthDays(startDate: string, endDate: string): number {
  return epochDay(parseDate(endDate)) - epochDay(parseDate(startDate)) + 1;
}

export function dayIndex(instantMs: number, tripStartDate: string, timezone: string): number {
  return epochDay(shiftedDate(instantMs, timezone)) - epochDay(parseDate(tripStartDate)) + 1;
}

export function dayLabel(
  instantMs: number,
  nowMs: number,
  tripStartDate: string,
  timezone: string,
): string {
  const index = dayIndex(instantMs, tripStartDate, timezone);
  if (index === dayIndex(nowMs, tripStartDate, timezone)) return 'Tonight';
  const date = shiftedDate(instantMs, timezone);
  const weekday = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(date.year, date.month - 1, date.day, 12));
  return `${weekday}, day ${index}`;
}
