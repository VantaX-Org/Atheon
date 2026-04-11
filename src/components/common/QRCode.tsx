import { useEffect, useRef } from 'react';

interface QRCodeProps {
  value: string;
  size?: number;
}

export function QRCode({ value, size = 200 }: QRCodeProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current) {
      const encoded = encodeURIComponent(value);
      imgRef.current.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&format=svg`;
    }
  }, [value, size]);

  return (
    <div className="flex flex-col items-center gap-2">
      <img
        ref={imgRef}
        width={size}
        height={size}
        alt="QR Code for MFA setup"
        className="rounded-lg"
        style={{ background: 'white', padding: 8 }}
      />
    </div>
  );
}
