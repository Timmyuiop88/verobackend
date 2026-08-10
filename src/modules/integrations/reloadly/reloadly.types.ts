/** Spring `Page<T>` envelope used by Reloadly's list endpoints. */
export type ReloadlyPage<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
  numberOfElements: number;
  empty: boolean;
};

export type ReloadlyCountry = {
  isoName: string;
  name: string;
  continent?: string;
  currencyCode?: string;
  currencyName?: string;
  currencySymbol?: string;
  flag?: string;
  callingCodes?: string[];
};

export type ReloadlyCategory = {
  id: number;
  name: string;
};

export type ReloadlyBrand = {
  brandId: number;
  brandName: string;
  logoUrl?: string;
};

export type ReloadlyRedeemInstruction = {
  concise?: string;
  verbose?: string;
};

export type ReloadlyProduct = {
  productId: number;
  productName: string;
  global?: boolean;
  status?: string;
  supportsPreOrder?: boolean;
  senderFee?: number;
  senderFeePercentage?: number;
  discountPercentage?: number;
  denominationType: 'FIXED' | 'RANGE';
  recipientCurrencyCode?: string;
  senderCurrencyCode?: string;
  recipientCurrencyToSenderCurrencyExchangeRate?: number;
  minRecipientDenomination?: number | null;
  maxRecipientDenomination?: number | null;
  minSenderDenomination?: number | null;
  maxSenderDenomination?: number | null;
  fixedRecipientDenominations?: number[];
  fixedSenderDenominations?: number[];
  /**
   * Face value → what Reloadly charges our balance. Documented both as a
   * plain object (`{ "25.00": 10264.5 }`) and as an array of single-key
   * objects (`[{ "25.00": 10264.5 }, { "50.00": 20529 }]`). Callers must
   * normalize both shapes — see `normalizeRecipientToSenderMap`.
   */
  fixedRecipientToSenderDenominationsMap?:
    | Record<string, number>
    | Array<Record<string, number>>;
  logoUrls?: string[];
  brand?: ReloadlyBrand;
  category?: ReloadlyCategory;
  country?: { isoName: string; name: string; flagUrl?: string };
  redeemInstruction?: ReloadlyRedeemInstruction;
  additionalRequirements?: { userIdRequired?: boolean };
  metadata?: Record<string, unknown>;
  /** Docs typo on some samples — keep alongside the camelCase form. */
  maxrecipientDenomination?: number | null;
};

/**
 * Flattens Reloadly's denomination cost map into `faceValueFixed4 → senderCost`.
 */
export function normalizeRecipientToSenderMap(
  map:
    | Record<string, number>
    | Array<Record<string, number>>
    | null
    | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!map) {
    return out;
  }

  const entries: Array<[string, number]> = Array.isArray(map)
    ? map.flatMap((entry) =>
        Object.entries(entry).map(
          ([key, value]) => [key, value] as [string, number],
        ),
      )
    : Object.entries(map);

  for (const [key, value] of entries) {
    const numeric = Number(key);
    if (Number.isFinite(numeric) && Number.isFinite(value)) {
      out.set(numeric.toFixed(4), value);
    }
  }
  return out;
}

export type ReloadlyDiscount = {
  product: {
    productId: number;
    productName?: string;
    countryCode?: string;
    global?: boolean;
  };
  discountPercentage: number;
};

export type ReloadlyProductRedeemInstruction = {
  productId: number;
  productName?: string;
  concise?: string;
  verbose?: string;
};

export type ReloadlyBalance = {
  balance: number;
  currencyCode: string;
  currencyName?: string;
  updatedAt?: string;
};

export type ReloadlyTransactionStatus =
  'SUCCESSFUL' | 'PENDING' | 'PROCESSING' | 'REFUNDED' | 'FAILED';

export type ReloadlyTransaction = {
  transactionId: number;
  amount?: number;
  discount?: number;
  currencyCode?: string;
  fee?: number;
  smsFee?: number;
  totalFee?: number;
  recipientEmail?: string;
  customIdentifier?: string;
  status: ReloadlyTransactionStatus;
  product?: {
    productId: number;
    productName?: string;
    countryCode?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    currencyCode?: string;
    brand?: ReloadlyBrand;
  };
  transactionCreatedTime?: string;
  preOrdered?: boolean;
  balanceInfo?: {
    oldBalance?: number;
    newBalance?: number;
    currencyCode?: string;
    updatedAt?: string;
  };
};

export type ReloadlyOrderRequest = {
  productId: number;
  quantity: number;
  /**
   * Must be a value from `fixedRecipientDenominations` (FIXED) or within
   * min/max recipient denomination (RANGE) — the *face value*, not our cost.
   */
  unitPrice: number;
  customIdentifier: string;
  senderName: string;
  recipientEmail?: string;
  recipientPhoneDetails?: { countryCode: string; phoneNumber: string };
  productAdditionalRequirements?: { userId?: string };
  preOrder?: boolean;
};

/** A single issued card. Every field here is a bearer secret. */
export type ReloadlyRedeemCode = {
  cardNumber?: string | number;
  pinCode?: string;
  /** Embeds the redemption code in its query string — treat as a secret. */
  redemptionUrl?: string;
};

export type ReloadlyFxRate = {
  senderCurrency: string;
  senderAmount: number;
  recipientCurrency: string;
  recipientAmount: number;
};
