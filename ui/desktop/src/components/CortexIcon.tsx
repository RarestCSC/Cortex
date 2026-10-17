import { CortexMark } from './icons/CortexMark';
import { cn } from '../utils';

interface CortexIconProps {
  className?: string;
  size?: 'default' | 'small';
  hover?: boolean;
}

export default function CortexIcon({
  className = '',
  size = 'default',
  hover = true,
}: CortexIconProps) {
  const sizes = {
    default: {
      frame: 'w-16 h-16',
      goose: 'w-16 h-16',
    },
    small: {
      frame: 'w-8 h-8',
      goose: 'w-8 h-8',
    },
  } as const;

  const currentSize = sizes[size];

  return (
    <div
      className={cn(
        className,
        currentSize.frame,
        'relative overflow-hidden',
        hover && 'group/with-hover'
      )}
    >
      <CortexMark className={cn(currentSize.goose, 'absolute left-0 bottom-0 z-2')} />
    </div>
  );
}
