import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
}

export default function IconButton({ label, children, title, ...props }: IconButtonProps) {
  return (
    <button {...props} aria-label={label} title={title ?? label}>
      {children}
    </button>
  );
}
