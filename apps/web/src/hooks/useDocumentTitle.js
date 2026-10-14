import { useEffect } from 'react';

const APP_NAME = 'FASALYTICS';
/** Sets a meaningful per-page document title (the Stitch exports had none). */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ${APP_NAME}` : APP_NAME;
  }, [title]);
}
