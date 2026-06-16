import { create } from 'zustand';

// ---------------------------------------------------------------------------
// usePrintJobStore — drives the global print overlay.
//
// Every physical send funnels through services/printer.ts → writeBytes(), which
// calls beginSend()/finishSend() around the Bluetooth connect+write. The overlay
// (components/PrintOverlay.tsx) shows a live elapsed-ms counter plus a Cancel
// button while a send is in flight. Its purpose is to let the user abort a hung
// or failed connection — on a successful send it simply disappears.
// ---------------------------------------------------------------------------

interface PrintJobState {
  /** True while a send is in flight (overlay visible). */
  visible: boolean;
  /** Date.now() when the current send started — the overlay ticks from here. */
  startedAt: number;
  /** Set true when the user taps Cancel; writeBytes polls this to abort. */
  cancelRequested: boolean;

  beginSend: () => void;
  requestCancel: () => void;
  finishSend: () => void;
}

export const usePrintJobStore = create<PrintJobState>((set) => ({
  visible: false,
  startedAt: 0,
  cancelRequested: false,

  beginSend: () => set({ visible: true, startedAt: Date.now(), cancelRequested: false }),
  requestCancel: () => set({ cancelRequested: true }),
  finishSend: () => set({ visible: false }),
}));
