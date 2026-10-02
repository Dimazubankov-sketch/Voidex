import { useId } from 'react';

/** Place dist/ contents in apps/web/public/apps/calculator/. */
export function VoidexCalculator({ className = '', title = 'Калькулятор' }: {
  className?: string;
  title?: string;
}) {
  const id = useId();
  return (
    <iframe
      id={id}
      title={title}
      src="/apps/calculator/index.html?embed=1"
      className={className}
      allow="camera; clipboard-write"
      style={{ display: 'block', border: 0, width: '100%', height: '100%', minHeight: 580, background: '#fff' }}
    />
  );
}
