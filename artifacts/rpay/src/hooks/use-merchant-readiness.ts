import { useQuery } from "@tanstack/react-query";
import { getMerchantReadiness } from "@workspace/api-client-react";
import { mapServerReadiness, MerchantReadinessUI } from "@/lib/readiness-logic";

export function useMerchantReadiness() {
  return useQuery<MerchantReadinessUI>({
    queryKey: ["/api/merchants/me/readiness"],
    queryFn: async () => mapServerReadiness(await getMerchantReadiness()),
    staleTime: 5 * 60 * 1000,
  });
}
