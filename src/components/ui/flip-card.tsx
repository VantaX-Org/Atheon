import { ReactNode } from 'react';

interface FlipCardProps {
  front: ReactNode;
  back: ReactNode;
  isFlipped: boolean;
  onFlip: () => void;
  className?: string;
  height?: string;
}

export function FlipCard({ front, back, isFlipped, onFlip, className = '', height = 'h-48' }: FlipCardProps) {
  return (
    <div
      className={`relative perspective-1000 cursor-pointer ${className}`}
      onClick={onFlip}
      style={{ height }}
    >
      <div
        className={`relative w-full h-full transition-transform duration-500 transform-style-preserve-3d ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front */}
        <div
          className="absolute w-full h-full backface-hidden"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {front}
        </div>

        {/* Back */}
        <div
          className="absolute w-full h-full backface-hidden rotate-y-180"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}

interface FlipCardContentProps {
  children: ReactNode;
  className?: string;
}

export function FlipCardFront({ children, className = '' }: FlipCardContentProps) {
  return (
    <div
      className={`w-full h-full rounded-xl p-5 flex flex-col ${className}`}
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      {children}
    </div>
  );
}

export function FlipCardBack({ children, className = '' }: FlipCardContentProps) {
  return (
    <div
      className={`w-full h-full rounded-xl p-5 flex flex-col ${className}`}
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      {children}
    </div>
  );
}
