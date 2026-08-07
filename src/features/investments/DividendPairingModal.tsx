import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DividendImportRawItem } from './dividendImport';
import { pairDividendsAndTaxes } from './dividendImport';

type Pairing = { dividendId: string; taxId: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (pairs: Pairing[]) => void;
  groupDividends: DividendImportRawItem[];
  groupTaxes: DividendImportRawItem[];
};

export default function DividendPairingModal({ isOpen, onClose, onApply, groupDividends, groupTaxes }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setSelections({});
    }
  }, [isOpen]);

  const taxOptions = useMemo(() => groupTaxes.map((t) => ({ value: t.sourceTransactionId, label: `${t.amount} — ${t.entryDate} — ${t.sourceTransactionId}` })), [groupTaxes]);

  const handleSelect = useCallback((divId: string, taxId: string) => {
    setSelections((prev) => ({ ...prev, [divId]: taxId }));
  }, []);

  const handleAutoSuggest = useCallback(() => {
    const result = pairDividendsAndTaxes(groupDividends, groupTaxes);
    const next: Record<string, string> = {};
    for (const p of result.matchedPairs) {
      next[p.dividend.sourceTransactionId] = p.tax.sourceTransactionId;
    }
    setSelections(next);
  }, [groupDividends, groupTaxes]);

  const handleApply = useCallback(() => {
    const pairs: Pairing[] = [];
    for (const [divId, taxId] of Object.entries(selections)) {
      if (taxId) {
        pairs.push({ dividendId: divId, taxId });
      }
    }
    onApply(pairs);
    onClose();
  }, [onApply, onClose, selections]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Emparejar dividendos y retenciones">
      <div className="modal" style={{ maxWidth: 980, width: '95%' }}>
        <header className="modal__header">
          <h3>Formar parejas: dividendos y retenciones</h3>
        </header>
        <div className="modal__body">
          <p>Empareja cada dividendo con la retención correspondiente. Usa "Auto-sugerir" para aplicar la heurística.</p>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h4>Dividendos</h4>
              <ul className="list-plain">
                {groupDividends.map((d) => (
                  <li key={d.sourceTransactionId} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ minWidth: 220 }}>{d.entryDate} — {d.amount} — {d.sourceTransactionId}</div>
                      <div style={{ flex: 1 }}>
                        <select
                          value={selections[d.sourceTransactionId] ?? ''}
                          onChange={(e) => handleSelect(d.sourceTransactionId, e.target.value)}
                        >
                          <option value="">— No emparejar —</option>
                          {groupTaxes.map((t) => (
                            <option key={t.sourceTransactionId} value={t.sourceTransactionId} disabled={Object.values(selections).includes(t.sourceTransactionId) && selections[d.sourceTransactionId] !== t.sourceTransactionId}>
                              {t.entryDate} — {t.amount} — {t.sourceTransactionId}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ width: 320 }}>
              <h4>Retenciones</h4>
              <ul className="list-plain">
                {groupTaxes.map((t) => (
                  <li key={t.sourceTransactionId} style={{ marginBottom: 8 }}>
                    <div>{t.entryDate} — {t.amount} — {t.sourceTransactionId}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <footer className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="tickets-button" onClick={handleAutoSuggest}>Auto-sugerir</button>
          <button type="button" className="tickets-button" onClick={onClose}>Cancelar</button>
          <button type="button" className="tickets-button tickets-button--primary" onClick={handleApply}>Aplicar</button>
        </footer>
      </div>
    </div>
  );
}
