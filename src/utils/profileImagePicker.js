import ImagePicker from 'react-native-image-crop-picker';

const PROFILE_PICK_OPTS = {
  width: 512,
  height: 512,
  cropping: true,
  cropperCircleOverlay: true,
  compressImageQuality: 0.88,
  includeBase64: true,
  mediaType: 'photo',
  forceJpg: true,
};

function mapToResult(image) {
  if (!image?.data) return null;
  const path = image.path || '';
  const uri =
    path.startsWith('file://') || path.startsWith('content://') ? path : path ? `file://${path}` : null;
  const s = String(image.data).trim();
  const m = s.match(/^data:image\/\w+;base64,(.+)$/);
  const base64 = m ? m[1] : s;
  return { uri, base64 };
}

async function runPick(openFn) {
  try {
    const image = await openFn();
    return mapToResult(image);
  } catch (e) {
    if (e?.code === 'E_PICKER_CANCELLED') return null;
    throw e;
  }
}

/** Opens camera → crop (square with circle guide) → returns { uri, base64 } or null if cancelled. */
export function pickProfilePhotoCamera() {
  return runPick(() =>
    ImagePicker.openCamera({
      ...PROFILE_PICK_OPTS,
      useFrontCamera: true,
    }),
  );
}

/** Opens gallery → crop → returns { uri, base64 } or null if cancelled. */
export function pickProfilePhotoLibrary() {
  return runPick(() => ImagePicker.openPicker(PROFILE_PICK_OPTS));
}
