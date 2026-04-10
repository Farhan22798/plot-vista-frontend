/**
 * Verbose logging only in development (__DEV__).
 * Metro / React Native sets __DEV__ = true in dev builds.
 */

export function devLog(tag, ...args) {
  if (__DEV__) {
    console.log(`[PlotVista:${tag}]`, ...args);
  }
}

export function devWarn(tag, ...args) {
  if (__DEV__) {
    console.warn(`[PlotVista:${tag}]`, ...args);
  }
}

export function devError(tag, ...args) {
  if (__DEV__) {
    console.error(`[PlotVista:${tag}]`, ...args);
  }
}

/** Best-effort CometChat / network error shape for logs */
export function serializeError(err) {
  if (err == null) {
    return { message: 'null error' };
  }
  const out = {
    message: err.message,
    name: err.name,
    code: err.code,
    details: err.details,
  };
  try {
    if (typeof err.getCode === 'function') {
      out.getCode = err.getCode();
    }
    if (typeof err.getMessage === 'function') {
      out.getMessage = err.getMessage();
    }
    if (typeof err.getDetails === 'function') {
      out.getDetails = err.getDetails();
    }
  } catch (_) {
    /* ignore */
  }
  try {
    out.stringified = JSON.stringify(err, ['message', 'name', 'code', 'details'], 2);
  } catch (_) {
    out.stringified = '(could not stringify)';
  }
  return out;
}
