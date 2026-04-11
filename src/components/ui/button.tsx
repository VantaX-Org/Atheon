import { cn } from "@/lib/utils";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

const variants: Record<string, string> = {
  primary: 'text-white',
  secondary: 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-input-focus)] t-primary border border-[var(--border-card)]',
  ghost: 'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary hover:t-primary',
  danger: 'bg-red-500/10 hover:bg-red-500/15 text-red-500 border border-red-500/20',
  success: 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-500 border border-emerald-500/20',
  outline: 'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary border border-[var(--border-card)]',
};

const sizes: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export function Button({ children, variant = 'primary', size = 'md', className, style, ...props }: ButtonProps) {
  const mergedStyle = variant === 'primary'
    ? { background: 'var(--accent)', ...style }
    : style;
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'hover:opacity-90 shadow-sm',
        variants[variant],
        sizes[size],
        className
      )}
      style={mergedStyle}
      {...props}
    >
      {children}
    </button>
  );
}
