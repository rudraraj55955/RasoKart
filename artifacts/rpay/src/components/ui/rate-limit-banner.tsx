import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RateLimitBannerProps {
  retryAfterSeconds: number;
  message?: string;
  onDismiss?: () => void;
}

export function RateLimitBanner({
  retryAfterSeconds,
  message = "Too many login attempts. Please wait before trying again.",
  onDismiss,
}: RateLimitBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(retryAfterSeconds);

  useEffect(() => {
    setSecondsLeft(retryAfterSeconds);
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onDismiss?.();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, onDismiss]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const countdown =
    mins > 0
      ? `${mins}m ${secs.toString().padStart(2, "0")}s`
      : `${secs}s`;

  return (
    <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-400 [&>svg]:text-amber-400">
      <Clock className="h-4 w-4" />
      <AlertDescription className="pl-1">
        <span className="font-medium">{message}</span>
        {secondsLeft > 0 && (
          <span className="ml-2 text-amber-300/80">
            Try again in {countdown}.
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function useRateLimit() {
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

  function handleRateLimitError(err: unknown): boolean {
    const e = err as Record<string, unknown>;
    const status = (e["status"] as number | undefined) ?? (e["response"] as Record<string, unknown> | undefined)?.["status"] as number | undefined;
    if (status === 429) {
      const headers = (e["headers"] as Headers | undefined) ?? (e["response"] as Record<string, unknown> | undefined)?.["headers"] as Headers | undefined;
      const resetHeader = headers?.get?.("RateLimit-Reset") ?? headers?.get?.("ratelimit-reset");
      const seconds = resetHeader ? parseInt(resetHeader, 10) : 60;
      setRateLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
      return true;
    }
    return false;
  }

  function dismiss() {
    setRateLimitSeconds(null);
  }

  return {
    rateLimitSeconds,
    isRateLimited: rateLimitSeconds !== null,
    handleRateLimitError,
    dismiss,
  };
}
