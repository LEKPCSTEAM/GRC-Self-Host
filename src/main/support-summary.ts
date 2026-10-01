/** A strict allowlist: source messages never enter the renderer or bundle. */
export function summarizeLog(input: string): string {
  return input
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const time =
        /^\[?(\d{4}-\d{2}-\d{2}[T ][\d:.+-]+Z?)\]?/.exec(line)?.[1] ??
        'time-unknown';
      const level =
        /\b(error|warn(?:ing)?|debug|info)\b/i.exec(line)?.[1]?.toLowerCase() ??
        'event';
      const category =
        /\b(update|upgrade)\b/i.test(line) && /\b(fail|error)\b/i.test(line)
          ? 'runner-update-failed'
          : /\b(rate limit)\b/i.test(line)
            ? 'rate-limit'
            : /\b(401|403|unauthorized|forbidden)\b/i.test(line)
              ? 'access-error'
              : /\b(timeout|ECONN|ENOTFOUND|network)\b/i.test(line)
                ? 'network-error'
                : /\b(crash|exited unexpectedly)\b/i.test(line)
                  ? 'runner-crash'
                  : /\b(job|workflow)\b/i.test(line) &&
                      /\b(completed|finished)\b/i.test(line)
                    ? 'job-completed'
                    : /\b(job|workflow)\b/i.test(line) &&
                        /\b(start|running)\b/i.test(line)
                      ? 'job-started'
                      : /\b(connect|listen)\b/i.test(line)
                        ? 'connection'
                        : level === 'error'
                          ? 'other-error'
                          : level === 'warn' || level === 'warning'
                            ? 'other-warning'
                            : 'other-event';
      return `${time} ${level} ${category}`;
    })
    .join('\n');
}
