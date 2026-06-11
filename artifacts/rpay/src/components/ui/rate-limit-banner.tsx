import { useEffect, useRef, useState, useCallback } from "react";
import { AlertTriangle, Clock } from "lucide-react";

const COOLDOWN_SECONDS = 30;

export function useRateLimit() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setSecondsLeft(0);
  }, []);

  const trigger = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSecondsLeft(COOLDOWN_SECONDS);
    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  return { isRateLimited: secondsLeft > 0, secondsLeft, trigger, clear };
}

export function RateLimitBanner({ secondsLeft, message }: { secondsLeft: number; message?: string }) {
  if (secondsLeft <= 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
      <div className="flex-1 min-w-0">
        {message ? (
          <span>{message}</span>
        ) : (
          <>
            <span className="font-semibold text-amber-200">Too many requests — </span>
            please wait before trying again.
          </>
        )}
        <span className="inline-flex items-center gap-1 ml-2 font-mono text-amber-400">
          <Clock className="w-3 h-3 shrink-0" />
          {secondsLeft}s
        </span>
      </div>
    </div>
  );
}
