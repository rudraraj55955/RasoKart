import { useGetPublicCompanySettings } from "@workspace/api-client-react";

export const LEGAL_COMPANY_NAME = "NICKEY COLLECTION PRIVATE LIMITED";
export const DEFAULT_COMPANY_NAME = "Nickey Collection Private Limited";
export const DEFAULT_SUPPORT_PHONE = "9358774496";
export const COMPANY_CIN = "U47820RJ2025PTC109583";
export const COMPANY_GSTIN = "08AALCN0945P1ZT";
export const COMPANY_INCORPORATION_DATE = "12 December 2025";
export const COMPANY_ROC = "ROC Jaipur";
export const COMPANY_STATUS = "Active";
export const COMPANY_REGISTERED_ADDRESS =
  "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur, Rajasthan – 302012, India";
export const COMPANY_WEBSITE = "https://rasokart.com";

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
