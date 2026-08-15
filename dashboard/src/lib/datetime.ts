// Formats a Date as the local-time string <input type="datetime-local"> expects,
// e.g. "2026-08-15T09:30". toISOString() can't be used here — it's UTC, which
// would silently shift the displayed value away from the user's local clock.
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// datetime-local has no timezone info, so new Date(value) parses it as local
// time — exactly what we want before sending it to the API as ISO 8601.
export function toIso(localDateTime: string): string | undefined {
  if (!localDateTime) return undefined;
  const d = new Date(localDateTime);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
