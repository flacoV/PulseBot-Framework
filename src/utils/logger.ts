const timestamp = () => new Date().toISOString();

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const log = (level: LogLevel, message: string, error?: unknown) => {
  const base = `[${timestamp()}] [${level}] ${message}`;

  if (error instanceof Error) {
    console.error(base, `\nStack: ${error.stack ?? "unknown stack"}`);
    return;
  }

  if (error) {
    console.error(base, `\nPayload: ${JSON.stringify(error, null, 2)}`);
    return;
  }

  switch (level) {
    case "WARN":
      console.warn(base);
      break;
    case "ERROR":
      console.error(base);
      break;
    default:
      console.log(base);
      break;
  }
};

export const logger = {
  info: (message: string, context?: unknown) => log("INFO", message, context),
  warn: (message: string, context?: unknown) => log("WARN", message, context),
  error: (message: string, error?: unknown) => log("ERROR", message, error),
  debug: (message: string, context?: unknown) => {
    if (process.env.NODE_ENV === "development") {
      log("DEBUG", message, context);
    }
  }
};

