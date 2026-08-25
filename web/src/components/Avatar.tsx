import { initialsOf } from "../api";

export default function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: color }}>
      {initialsOf(name)}
    </span>
  );
}
