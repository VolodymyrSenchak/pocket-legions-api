type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as keyof typeof LEVEL_ORDER | undefined;
  return (configured && LEVEL_ORDER[configured]) ?? LEVEL_ORDER.info;
}

function serialize(data: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) =>
      value instanceof Error ? [key, { message: value.message, stack: value.stack }] : [key, value]
    )
  );
}

function write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold()) {
    return;
  }
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...serialize(data) });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** Structured (JSON line) logger. `LOG_LEVEL=silent` disables output. */
export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => write("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};
