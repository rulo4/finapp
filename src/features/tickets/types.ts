export type TicketStatus = 'pending' | 'processing' | 'processed' | 'saved' | 'error';

export type ParsedTicketExpense = {
  entry_date: string;
  concept: string;
  quantity: number;
  unit_of_measure_id: string | null;
  unit_of_measure_text: string | null;
  subtotal_original: number;
  currency_code: 'MXN' | 'USD';
  suggested_store_id: string | null;
  suggested_store_text: string | null;
  suggested_payment_instrument_id: string | null;
  suggested_payment_instrument_text: string | null;
  suggested_category_id: string | null;
  suggested_category_text: string | null;
  notes: string;
};

export type TicketRecord = {
  id: string;
  storage_path: string;
  status: TicketStatus;
  entry_date: string | null;
  store_id: string | null;
  payment_instrument_id: string | null;
  raw_llm_response: unknown;
  parsed_expenses: ParsedTicketExpense[] | null;
  error_message: string | null;
  created_at: string;
};
