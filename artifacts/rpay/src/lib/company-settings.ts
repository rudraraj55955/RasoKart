import { useGetPublicCompanySettings } from "@workspace/api-client-react";

export const DEFAULT_COMPANY_NAME = "Nickey Collection Private Limited";
export const DEFAULT_SUPPORT_PHONE = "9358774496";

export function useCompanySettings() {
  const { data } = useGetPublicCompanySettings();
  return {
    companyName: data?.companyName || DEFAULT_COMPANY_NAME,
    supportPhone: data?.supportPhone || DEFAULT_SUPPORT_PHONE,
    supportEmail: data?.supportEmail || undefined,
    whatsappPhone: data?.whatsappPhone || undefined,
    companyAddress: data?.companyAddress || undefined,
    footerText: data?.footerText || undefined,
    grievanceOfficerName: data?.grievanceOfficerName || undefined,
  };
}
