import React, { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

type ModalProps = {
  children: React.ReactNode;
  ariaLabel?: string;
  onClose: () => void;
};

export default function Modal({ children, ariaLabel = 'Dialog', onClose }: ModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={onClose}>
      <div className="image-viewer__content" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="image-viewer__close" onClick={onClose} aria-label="Cerrar">
          <FontAwesomeIcon icon={faXmark} />
        </button>
        {children}
      </div>
    </div>
  );
}
