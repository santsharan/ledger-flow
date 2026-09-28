"use client";

import { atom } from "jotai";

export const sidebarOpenAtom = atom(true);

export const paymentFiltersAtom = atom({
  status: "",
  limit: 25,
  offset: 0,
});

export const selectedPaymentIdAtom = atom<string | null>(null);
export const selectedCaseIdAtom = atom<string | null>(null);

export interface ToastMessage {
  readonly id: string;
  readonly tone: "ok" | "danger" | "info";
  readonly text: string;
}

export const toastsAtom = atom<ToastMessage[]>([]);

export interface ConfirmRequest {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
  readonly resolve: (accepted: boolean) => void;
}

export const confirmAtom = atom<ConfirmRequest | null>(null);
