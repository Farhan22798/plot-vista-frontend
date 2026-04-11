/**
 * Normalize ids for REST path segments (string, ObjectId-like, or EJSON { $oid }).
 */
export function idForApiPath(id) {
  if (id == null) return '';
  if (typeof id === 'object' && id !== null && typeof id.$oid === 'string') {
    return id.$oid;
  }
  return String(id);
}
