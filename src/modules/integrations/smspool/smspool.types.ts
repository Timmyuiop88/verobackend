export type SmsPoolCountry = {
  ID: number;
  name: string;
  short_name: string;
  region?: string;
};

export type SmsPoolService = {
  ID: number;
  name: string;
  favourite?: number;
};

export type SmsPoolPriceRow = {
  service: number;
  service_name?: string;
  country: number;
  country_name?: string;
  short_name?: string;
  pool?: number;
  price: string | number;
};

export type SmsPoolSpecificPrice = {
  pool?: number;
  high_price?: string;
  price: string | number;
  success_rate?: number;
};

export type SmsPoolBalance = {
  balance: string | number;
};

export type SmsPoolPurchaseSmsResult = {
  success: number;
  number?: number | string;
  cc?: string;
  phonenumber?: string;
  order_id?: string;
  country?: string;
  service?: string;
  pool?: number;
  expires_in?: number;
  expiration?: number;
  message?: string;
  cost?: string | number;
  cost_in_cents?: number;
};

export type SmsPoolActiveOrder = {
  timestamp?: string;
  cost?: string;
  order_code: string;
  phonenumber?: string;
  code?: string;
  full_code?: string;
  short_name?: string;
  service?: string;
  status?: string;
  expiry?: number;
  time_left?: number;
};

export type SmsPoolRentalSku = {
  ID: number;
  name: string;
  tag?: string;
  region?: string;
  pricing?: Record<string, number | string>;
  priority?: number;
  pool?: number;
  single_service?: number | null;
  single_service_extend?: number | null;
};

export type SmsPoolPurchaseRentalResult = {
  success: number;
  message?: string;
  phonenumber?: string | number;
  days?: number;
  rental_code?: string;
  expiry?: number;
};

export type SmsPoolRentalStatus = {
  success?: number;
  status?: {
    available?: number;
    phonenumber?: string | number;
    activeFor?: number;
    expiry?: number;
    auto_extend?: number;
  };
};

export type SmsPoolRentalMessage = {
  ID?: number;
  message?: string;
  sender?: string;
  timestamp?: string;
};

export type SmsPoolRentalMessagesResult = {
  success?: number;
  messages?: SmsPoolRentalMessage[];
  source?: number;
};

export type SmsPoolRentalInfo = {
  refund?: number;
  rental?: number;
  price?: string;
  type?: number;
  auto_extend?: number;
  rental_code?: string;
  phonenumber?: string | number;
  expiration_date?: number;
  country_name?: string;
  source?: number;
  service?: number;
  service_name?: string;
};

export type SmsPoolActiveRental = {
  rental?: number;
  type?: number;
  rental_code: string;
  phonenumber?: string | number;
  expiration_date?: number;
  country_name?: string;
  source?: number;
  state?: string;
};
