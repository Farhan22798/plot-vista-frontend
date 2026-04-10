/**
 * Module-level registry so LayoutScreen (always mounted as a tab) can expose its
 * map-capture function to ProfileScreen without prop-drilling or context overhead.
 *
 * LayoutScreen writes:  mapCaptureRegistry.capture = async () => base64String
 * ProfileScreen reads:  const b64 = await mapCaptureRegistry.capture?.()
 */
export const mapCaptureRegistry = { capture: null };
