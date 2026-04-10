import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../services/api';
import { AuthContext } from './AuthContext';
import { avatarLookupKey, avatarMobileKey } from '../utils/formatting';

export const UserAvatarContext = createContext({
  getAvatar: () => null,
  refreshAvatars: async () => {},
});

export function UserAvatarProvider({ children }) {
  const { userToken } = useContext(AuthContext);
  const [map, setMap] = useState({});

  const refreshAvatars = useCallback(async () => {
    if (!userToken) {
      setMap({});
      return;
    }
    try {
      const res = await authApi.get('/avatars', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const next = {};
      for (const row of res.data || []) {
        const url = row.profilePicUrl && String(row.profilePicUrl).trim();
        if (!url) continue;
        const nk = avatarLookupKey(row.name);
        if (nk) next[nk] = url;
        const mk = avatarMobileKey(row.mobileNumber);
        if (mk) next[`m:${mk}`] = url;
      }
      setMap(next);
    } catch (e) {
      if (__DEV__) {
        console.warn('[UserAvatarContext] GET /auth/avatars failed:', e?.response?.status, e?.message);
      }
      setMap({});
    }
  }, [userToken]);

  useEffect(() => {
    refreshAvatars();
  }, [refreshAvatars]);

  const getAvatar = useCallback(
    (rawName) => {
      const nk = avatarLookupKey(rawName);
      if (nk && map[nk]) return map[nk];
      const mk = avatarMobileKey(rawName);
      if (mk && map[`m:${mk}`]) return map[`m:${mk}`];
      return null;
    },
    [map],
  );

  const value = React.useMemo(
    () => ({ getAvatar, refreshAvatars }),
    [getAvatar, refreshAvatars],
  );

  return <UserAvatarContext.Provider value={value}>{children}</UserAvatarContext.Provider>;
}
