const UNIT_MAP: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000
};

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export const parseDurationInput = (raw: string): number | null => {
  const input = raw.trim().toLowerCase();
  const match = input.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  if (!unit) return null;

  const normalizedUnit = unit.toLowerCase();
  const multiplier = UNIT_MAP[normalizedUnit];
  if (!multiplier) return null;

  const durationMs = amount * multiplier;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    return null;
  }

  return durationMs;
};

export const formatDuration = (durationMs: number): string => {
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
};



