import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Role-to-capability map.
 * Add new roles here only — components never check role strings directly.
 */
const ROLE_PERMISSIONS = {
  super_admin: {
    canEdit: true,
    canViewDetails: true,
    canViewAreaStatement: true,
    canViewWaitingList: true,
    canViewSummary: true,
    canUseChat: true,
    canBulkSelect: true,
    canAccessAdmin: true,
    isGuest: false,
  },
  owner: {
    canEdit: true,
    canViewDetails: true,
    canViewAreaStatement: true,
    canViewWaitingList: true,
    canViewSummary: true,
    canUseChat: true,
    canBulkSelect: true,
    canAccessAdmin: false,
    isGuest: false,
  },
  guest: {
    canEdit: false,
    canViewDetails: false,
    canViewAreaStatement: false,
    canViewWaitingList: false,
    canViewSummary: false,
    canUseChat: false,
    canBulkSelect: false,
    canAccessAdmin: false,
    isGuest: true,
  },
};

const GUEST_PERMISSIONS = ROLE_PERMISSIONS.guest;

/**
 * Returns a stable permissions object for the currently logged-in user.
 * Falls back to guest-level permissions for any unknown role.
 */
export function usePermissions() {
  const { effectiveRole, userInfo } = useContext(AuthContext);
  const role = effectiveRole || userInfo?.role;
  return ROLE_PERMISSIONS[role] ?? GUEST_PERMISSIONS;
}
