import { useEffect, useRef } from 'react';
import { initCometChatOnce } from '../../services/cometchatLifecycle';
import { devLog } from '../../utils/devLog';

/**
 * Runs CometChat UI Kit init as early as possible (outside AuthProvider).
 * Does not wait for PlotVista login, backend warmup, or navigation.
 */
export default function CometChatInit() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    devLog('CometChatInit', 'starting initCometChatOnce (early, pre-auth)');
    initCometChatOnce();
  }, []);

  return null;
}
