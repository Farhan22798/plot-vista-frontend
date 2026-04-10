/**
 * Shared pricing resolution helpers.
 * Prefer `scholar`; fall back to legacy aalim/hafiz/imam from older documents.
 */

export function resolveScholarPricing(pricing) {
  const p = pricing || {};
  if (p.scholar && typeof p.scholar === 'object') return { ...p.scholar };
  const legacy = p.aalim || p.hafiz || p.imam;
  if (legacy && typeof legacy === 'object') return { ...legacy };
  return {};
}

export function resolveRegularPricing(pricing) {
  const p = pricing || {};
  if (p.regular && typeof p.regular === 'object') return { ...p.regular };
  return {};
}
