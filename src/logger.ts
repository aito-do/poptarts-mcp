type LogFields = Record<string, unknown>;

function formatLine(level: "info" | "error", message: string, fields?: LogFields): string {
  const payload = {
    level,
    msg: message,
    time: new Date().toISOString(),
    ...(fields ?? {}),
  };
  return JSON.stringify(payload);
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    console.log(formatLine("info", message, fields));
  },
  error(message: string, fields?: LogFields): void {
    console.error(formatLine("error", message, fields));
  },
};
