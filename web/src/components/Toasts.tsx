import { useEffect, useState } from "react";
import { getToasts, subscribeToasts, type ToastItem } from "../toast";

export default function Toasts() {
  const [items, setItems] = useState<ToastItem[]>(getToasts());
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={"toast " + (t.ok ? "ok" : "err")}>{t.text}</div>
      ))}
    </div>
  );
}
