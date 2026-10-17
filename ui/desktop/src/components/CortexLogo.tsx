import cortexBrand from '../assets/cortex-brand.svg?raw';

interface CortexLogoProps {
  className?: string;
}

export function CortexLogo({ className = '' }: CortexLogoProps) {
  return (
    <span
      className={className}
      role="img"
      aria-label="Cortex"
      dangerouslySetInnerHTML={{ __html: cortexBrand }}
    />
  );
}
