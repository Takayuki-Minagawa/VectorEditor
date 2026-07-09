import type { ReactNode } from 'react';

interface PropertyFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function PropertyField({ label, children, className }: PropertyFieldProps) {
  return (
    <div className={`prop-row${className ? ` ${className}` : ''}`}>
      <label>{label}</label>
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
  return (
    <PropertyField label={label}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={onBlur}
        min={min}
        max={max}
        step={step}
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

export function ColorField({ label, value, onChange, onBlur }: ColorFieldProps) {
  return (
    <PropertyField label={label}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </PropertyField>
  );
}
