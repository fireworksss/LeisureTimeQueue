/** Return the IANA time zone reported by the current operating environment. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Common representative IANA zones ordered broadly from UTC-12 through UTC+14. */
const REPRESENTATIVE_TIME_ZONES = [
  'Etc/GMT+12',
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Noronha',
  'Atlantic/Azores',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Australia/Eucla',
  'Asia/Tokyo',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Noumea',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
] as const

/** Build a compact select list while keeping system and saved values available. */
export function timeZoneOptions(current: string): readonly string[] {
  return [...new Set([systemTimeZone(), current, ...REPRESENTATIVE_TIME_ZONES])]
}
