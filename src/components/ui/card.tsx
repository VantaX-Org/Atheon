import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  variant?: 'default' | 'black' | 'mint';
  onClick?: () => void;
  style?: React.CSSProperties;
}

const variantClass: Record<string, string> = {
  default: 'card-dark',
  black: 'card-black',
  mint: 'card-mint',
};

export function Card({ children, className, hover, glow, variant = 'default', onClick, style }: CardProps) {
  return (
    <div
      className={cn(
        variantClass[variant] || 'card-dark',
        'p-5',
        hover && 'cursor-pointer',
        glow && 'animate-glow-pulse',
        className
      )}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-lg font-semibold t-primary', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm t-muted mt-1', className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('', className)}>{children}</div>;
}
