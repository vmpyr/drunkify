import { create } from 'zustand';

export interface ToastSpec {
  title: string;
  undo?: () => void;
  undoLabel?: string;
  /** Rate-from-toast (DS §6.3): shown after logging anything that isn't a soft drink. */
  rate?: { prompt: string; onRate: (rating: number) => void };
}

export interface BannerSpec {
  title: string;
  body: string;
}

interface OverlayState {
  toast: (ToastSpec & { id: number }) | null;
  banner: (BannerSpec & { id: number }) | null;
  tabsVisible: number;
  showToast: (toast: ToastSpec) => void;
  hideToast: () => void;
  showBanner: (banner: BannerSpec) => void;
  hideBanner: () => void;
  setTabsVisible: (delta: 1 | -1) => void;
}

let seq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const bannerQueue: BannerSpec[] = [];
let bannerBusy = false;

export const useOverlays = create<OverlayState>((set, get) => ({
  toast: null,
  banner: null,
  tabsVisible: 0,
  showToast: (toast) => {
    clearTimeout(toastTimer);
    set({ toast: { ...toast, id: ++seq } });
    toastTimer = setTimeout(() => set({ toast: null }), 6500);
  },
  hideToast: () => {
    clearTimeout(toastTimer);
    set({ toast: null });
  },
  showBanner: (banner) => {
    bannerQueue.push(banner);
    if (bannerBusy) return;
    const next = () => {
      const item = bannerQueue.shift();
      if (!item) {
        bannerBusy = false;
        return;
      }
      bannerBusy = true;
      // DS §6.4: the banner lands 700 ms after the log toast, stays 4.2 s.
      setTimeout(() => {
        set({ banner: { ...item, id: ++seq } });
        try {
          navigator.vibrate?.(12);
        } catch {
          /* optional */
        }
        setTimeout(() => {
          get().hideBanner();
          setTimeout(next, 400);
        }, 4200);
      }, 700);
    };
    next();
  },
  hideBanner: () => set({ banner: null }),
  setTabsVisible: (delta) => set((state) => ({ tabsVisible: state.tabsVisible + delta })),
}));

export const toast = (spec: ToastSpec | string) =>
  useOverlays.getState().showToast(typeof spec === 'string' ? { title: spec } : spec);
