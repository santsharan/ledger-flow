"use client";

import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { Button } from "@/components/atoms/button";
import { confirmAtom, toastsAtom } from "@/state/atoms";

export function ConfirmHost() {
  const [request, setRequest] = useAtom(confirmAtom);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, [request]);

  if (request === null) return null;

  function close(accepted: boolean) {
    request?.resolve(accepted);
    setRequest(null);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-lg rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {request.title}
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{request.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="quiet" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={request.danger ? "danger" : "primary"}
            onClick={() => close(true)}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ToastRegion() {
  const [toasts, setToasts] = useAtom(toastsAtom);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed right-4 bottom-4 z-30 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`rounded-md border px-3 py-2 text-left text-sm ${
            toast.tone === "danger"
              ? "border-danger/40 bg-panel text-danger"
              : "border-line bg-panel text-ink"
          }`}
          onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}
