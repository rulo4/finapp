import { useEffect, useRef, useState } from 'react';

type ResultCallback = (transcript: string) => void;

export function useSpeechRecognition() {
  const recognitionRef = useRef<any | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  });
  const [isListening, setIsListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));

    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.stop();
        }
      } catch {}
    };
  }, []);

  function startListening(onResult: ResultCallback, lang = 'es-MX') {
    if (!isSupported) {
      setLastError('Reconocimiento de voz no soportado');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setLastError('SpeechRecognition no disponible');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        try {
          const transcript = Array.from(event.results)
            .map((r: any) => r[0]?.transcript ?? '')
            .join(' ')
            .trim();
          console.debug('[useSpeech] onresult:', transcript);
          onResult(transcript);
        } catch (err) {
          setLastError(err instanceof Error ? err.message : String(err));
        }
      };

      recognition.onstart = () => {
        console.debug('[useSpeech] onstart');
        setIsListening(true);
      };

      recognition.onaudiostart = () => {
        console.debug('[useSpeech] onaudiostart');
      };

      recognition.onerror = (event: any) => {
        console.debug('[useSpeech] onerror:', event);
        setLastError(event?.error ?? 'error desconocido');
      };

      recognition.onend = () => {
        console.debug('[useSpeech] onend');
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      setLastError(null);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setIsListening(false);
      recognitionRef.current = null;
    }
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {}
    recognitionRef.current = null;
    setIsListening(false);
  }

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
    lastError,
  };
}

export default useSpeechRecognition;
