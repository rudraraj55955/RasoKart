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
