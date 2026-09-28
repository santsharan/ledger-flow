"use client";

import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { confirmAtom, toastsAtom, type ToastMessage } from "@/state/atoms";

export function useConfirm(): (input: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}) => Promise<boolean> {
  const setConfirm = useSetAtom(confirmAtom);
  return useCallback(
    (input) =>
      new Promise<boolean>((resolve) => {
        setConfirm({
          title: input.title,
          body: input.body,
          confirmLabel: input.confirmLabel,
          danger: input.danger ?? false,
          resolve,
        });
      }),
    [setConfirm],
  );
}

export function useToast(): (toast: Omit<ToastMessage, "id">) => void {
  const setToasts = useSetAtom(toastsAtom);
  return useCallback(
    (toast) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { ...toast, id }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 5000);
    },
    [setToasts],
  );
}
