export const CUSTOMER_CATEGORY_REGULAR = 'regular';
export const CUSTOMER_CATEGORY_SCHOLAR = 'scholar';

export const CUSTOMER_CATEGORY_OPTIONS = [
  { value: 'regular', label: 'Regular' },
  { value: 'scholar', label: 'Alim / Hafiz' },
];

export function normalizeCustomerCategory(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (
    s === 'scholar' ||
    s === 'alim' ||
    s === 'hafiz' ||
    s === 'alim hafiz' ||
    s === 'aalim' ||
    s === 'imam'
  ) {
    return 'scholar';
  }
  return 'regular';
}

export function labelForCustomerCategory(v) {
  return normalizeCustomerCategory(v) === 'scholar' ? 'Alim / Hafiz' : 'Regular';
}
