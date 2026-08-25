export interface ToastItem {
  id: number;
  ok: boolean;
  text: string;
}

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
let listeners: Listener[] = [];
let seq = 0;

export function pushToast(ok: boolean, text: string) {
  const item: ToastItem = { id: ++seq, ok, text };
  toasts = [...toasts, item];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, 4200);
}

export function getToasts(): ToastItem[] {
  return toasts;
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emit() {
  for (const l of listeners) l(toasts);
}
