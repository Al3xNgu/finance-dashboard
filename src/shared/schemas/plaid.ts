import { z } from "zod";

// Shared between client and server — no server-only imports here.
export const exchangePublicTokenSchema = z.object({
  publicToken: z.string().min(1),
});

export type ExchangePublicTokenInput = z.infer<typeof exchangePublicTokenSchema>;
