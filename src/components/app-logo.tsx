import Image from "next/image";
import { cn } from "@/lib/utils";

export function AppLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/icon-192.png"
      alt="Minha IA"
      width={48}
      height={48}
      className={cn("rounded-lg shadow-lg shadow-emerald-500/10", className)}
      priority
    />
  );
}
