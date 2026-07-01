"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-zinc-600">{description}</p>
    </div>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-11 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-10 sm:text-sm ${className}`} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`min-h-28 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:min-h-24 sm:text-sm ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-11 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-10 sm:text-sm ${className}`} />;
}

export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-10 max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition duration-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98] ${className}`}
    />
  );
}

export function GhostButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition duration-200 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98] ${className}`}
    />
  );
}
