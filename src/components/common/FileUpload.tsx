import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  accept?: string;
  maxSizeMB?: number;
  label?: string;
  description?: string;
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error';

export function FileUpload({
  onUpload,
  accept = '.csv,.xlsx,.xls',
  maxSizeMB = 50,
  label = 'Upload File',
  description = 'Drag and drop your CSV or Excel file here, or click to browse',
}: FileUploadProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) return `File exceeds ${maxSizeMB}MB limit`;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = accept.split(',').map(a => a.trim().replace('.', ''));
    if (ext && !allowed.includes(ext)) return `Unsupported format. Allowed: ${accept}`;
    if (file.size === 0) return 'File is empty';
    return null;
  };

  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setState('error');
      return;
    }

    setFileName(file.name);
    setState('uploading');
    setError(null);
    setProgress(0);

    // Simulate progress while uploading
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 10, 90));
    }, 200);

    try {
      await onUpload(file);
      clearInterval(progressInterval);
      setProgress(100);
      setState('success');
    } catch (e) {
      clearInterval(progressInterval);
      setError(e instanceof Error ? e.message : 'Upload failed');
      setState('error');
    }
  }, [onUpload, maxSizeMB, accept]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState('dragging');
  }, []);

  const handleDragLeave = useCallback(() => {
    setState('idle');
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => {
    setState('idle');
    setProgress(0);
    setError(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="w-full">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => state !== 'uploading' && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        className={`
          relative flex flex-col items-center justify-center w-full p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
          ${state === 'dragging' ? 'border-[var(--accent)] bg-[var(--accent-subtle)]' : ''}
          ${state === 'error' ? 'border-red-400 bg-red-50/5' : ''}
          ${state === 'success' ? 'border-emerald-400 bg-emerald-50/5' : ''}
          ${state === 'idle' ? 'border-[var(--border-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]' : ''}
          ${state === 'uploading' ? 'border-[var(--accent)] pointer-events-none' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
          aria-hidden="true"
        />

        {state === 'idle' || state === 'dragging' ? (
          <>
            <Upload className="w-10 h-10 t-muted mb-3" />
            <p className="text-sm font-medium t-primary">{label}</p>
            <p className="text-xs t-muted mt-1">{description}</p>
            <p className="text-xs t-muted mt-1">Max {maxSizeMB}MB</p>
          </>
        ) : null}

        {state === 'uploading' && (
          <>
            <FileText className="w-10 h-10 mb-3" style={{ color: 'var(--accent)' }} />
            <p className="text-sm font-medium t-primary">{fileName}</p>
            <div className="w-full max-w-xs mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: 'var(--accent)' }}
              />
            </div>
            <p className="text-xs t-muted mt-2">Uploading... {progress}%</p>
          </>
        )}

        {state === 'success' && (
          <>
            <CheckCircle className="w-10 h-10 text-emerald-500 mb-3" />
            <p className="text-sm font-medium t-primary">{fileName}</p>
            <p className="text-xs text-emerald-500 mt-1">Upload complete</p>
            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              className="mt-3 text-xs t-muted hover:underline flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Upload another file
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <p className="text-sm font-medium text-red-500">{error}</p>
            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              className="mt-3 text-xs t-muted hover:underline flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
