import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface PropertyFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  labelFor?: string;
}

export function PropertyField({ label, children, className, labelFor }: PropertyFieldProps) {
  return (
    <div className={`prop-row${className ? ` ${className}` : ''}`}>
      <label htmlFor={labelFor}>{label}</label>
      {children}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({
  label,
  value,
  onChange,
  onBlur,
  min,
  max,
  step,
}: NumberFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(String(value));
  const cancelCommitRef = useRef(false);
  const parsed = Number(draft);
  const valid = draft.trim() !== ''
    && Number.isFinite(parsed)
    && (min === undefined || parsed >= min)
    && (max === undefined || parsed <= max);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setDraft(String(value));
      return;
    }
    if (valid) {
      onChange(parsed);
      setDraft(String(parsed));
      onBlur?.();
      return;
    }
    setDraft(String(value));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelCommitRef.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <PropertyField label={label} labelFor={inputId}>
      <input
        id={inputId}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        step={step}
        aria-invalid={!valid}
      />
    </PropertyField>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  validate?: (value: string) => boolean;
}

export function TextField({ label, value, onCommit, placeholder, validate }: TextFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  const cancelCommitRef = useRef(false);
  const valid = validate?.(draft) ?? true;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setDraft(value);
      return;
    }
    if (valid) onCommit(draft);
    else setDraft(value);
  };

  return (
    <PropertyField label={label} labelFor={inputId}>
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelCommitRef.current = true;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-invalid={!valid}
      />
    </PropertyField>
  );
}

export function ColorField({ label, value, onChange, onBlur }: ColorFieldProps) {
  const inputId = useId();
  return (
    <PropertyField label={label} labelFor={inputId}>
      <input
        id={inputId}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </PropertyField>
  );
}
