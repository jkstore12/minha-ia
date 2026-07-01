import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateTitle(value: string, maxLength = 64) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed || "Nova conversa";
  return `${trimmed.slice(0, maxLength - 1).trim()}...`;
}
