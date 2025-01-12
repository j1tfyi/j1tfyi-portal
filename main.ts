import { serve } from "https://deno.land/std@0.193.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.193.0/http/file_server.ts";
import { gzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";

// ---------------------- Constants ----------------------
const STATIC_CACHE_MAX_AGE = 31536000;  // 1 year in seconds
const DYNAMIC_CACHE_MAX_AGE = 3600;      // 1 hour in seconds

// Rate limiting configuration
const RATE_LIMIT = 50;                   // requests per window
const RATE_WINDOW = 30000;               // 30 seconds in milliseconds
const rateLimitStore = new Map<string, { count: number; timestamp: number }>();

// Widget configuration constants
const DEBRIDGE_REFERRAL_CODE = "31021";
const JUPITER_REFERRAL_PUBKEY = "FP5JGryFjTNdYustodtw9zLV31fdds5vvieW7TYzP8VJ";
const JUPITER_REFERRAL_LINK = "https://jup.ag/?referrer=FP5JGryFjTNdYustodtw9zLV31fdds5vvieW7TYzP8VJ&feeBps=100";
const SOLANA_PUBLIC_KEY = "FWBUqaHuaRPpN4BsbcP255RVUezvf67n2zYGY6SrZfzZ";
const EVM_RECIPIENT = "0xe83A14f6eae56B0b30465B48a2DE75B2DF895223";

const SUPPORTED_CHAINS = {
  EVM: [1, 10, 56, 137, 8453, 42161, 43114],
  SOLANA: [7565164],
};

// ---------------------- Rate Limiting Functions ----------------------
function checkRateLimit(ip: string): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const userRateLimit = rateLimitStore.get(ip);

  if (!userRateLimit) {
    rateLimitStore.set(ip, { count: 1, timestamp: now });
    return { allowed: true, remaining: RATE_LIMIT - 1, reset: now + RATE_WINDOW };
  }

  if (now - userRateLimit.timestamp > RATE_WINDOW) {
    rateLimitStore.set(ip, { count: 1, timestamp: now });
    return { allowed: true, remaining: RATE_LIMIT - 1, reset: now + RATE_WINDOW };
  }

  if (userRateLimit.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, reset: userRateLimit.timestamp + RATE_WINDOW };
  }

  userRateLimit.count++;
  rateLimitStore.set(ip, userRateLimit);
  return { 
    allowed: true, 
    remaining: RATE_LIMIT - userRateLimit.count, 
    reset: userRateLimit.timestamp + RATE_WINDOW 
  };
}

function addRateLimitHeaders(headers: Headers, rateLimitInfo: { remaining: number; reset: number }): void {
  headers.set("X-RateLimit-Limit", RATE_LIMIT.toString());
  headers.set("X-RateLimit-Remaining", rateLimitInfo.remaining.toString());
  headers.set("X-RateLimit-Reset", Math.ceil(rateLimitInfo.reset / 1000).toString());
}

// Clean up old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now - data.timestamp > RATE_WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_WINDOW / 2);

// ---------------------- Widget Helper Functions ----------------------
function getAffiliateFeeRecipient(inputChain: number): string {
  if (SUPPORTED_CHAINS.SOLANA.includes(inputChain)) {
    return SOLANA_PUBLIC_KEY;
  }
  if (SUPPORTED_CHAINS.EVM.includes(inputChain)) {
    return EVM_RECIPIENT;
  }
  throw new Error(`Unsupported chain ID: ${inputChain}`);
}

function getReferralKey(inputChain: number): string {
  if (SUPPORTED_CHAINS.SOLANA.includes(inputChain)) {
    return JUPITER_REFERRAL_PUBKEY;
  }
  if (SUPPORTED_CHAINS.EVM.includes(inputChain)) {
    return DEBRIDGE_REFERRAL_CODE;
  }
  throw new Error(`Unsupported chain ID: ${inputChain}`);
}

// Widget configuration object
const WIDGET_CONFIG = {
  v: "1",
  element: "debridgeWidget",
  title: "J1T.FYI Bridge Gate",
  description: "Just One Token, Just One Gate",
  width: "600",
  height: "800",
  inputChain: 1,
  outputChain: 7565164,
  inputCurrency: "",
  outputCurrency: "HAqD46mR4LgY3aJiMZSabfefZoysG3Uuj6wn2ZKYE14v",
  address: "",
  showSwapTransfer: true,
  amount: "",
  outputAmount: "",
  isAmountFromNotModifiable: false,
  isAmountToNotModifiable: false,
  lang: "en",
  mode: "deswap",
  isEnableCalldata: false,
  styles:
    'eyJhcHBCYWNrZ3JvdW5kIjoiIzQ3NDY0NiIsIm1vZGFsQmciOiIjMDAwMDAwIiwiY2hhcnRCZyI6IiMwMDAwMDAiLCJib3JkZXJDb2xvciI6IiMwMDAwMDAiLCJ0b29sdGlwQmciOiIjMDAwMDAwIiwiZm9ybUNvbnRyb2xCZyI6IiMwMjAyMDIiLCJjb250cm9sQm9yZGVyIjoiIzc0NzQ3NCIsInByaW1hcnkiOiIjMDAwMDAwIiwic2Vjb25kYXJ5IjoiIzQ3NDY0NiIsInN1Y2Nlc3MiOiIjMDA2NDA3IiwiZXJyb3IiOiIjY2QwMTAxIiwid2FybmluZyI6IiNlNGU3MDMiLCJmb250Q29sb3IiOiIjRkZGRkZGIiwiZm9udEZhbWlseSI6IkF1ZGlvd2lkZSIsInByaW1hcnlCdG5CZyI6IiM4MzAyMDIiLCJwcmltYXJ5QnRuQmdIb3ZlciI6IiMwYTBhMGEiLCJwcmltYXJ5QnRuVGV4dCI6IiNkNGQ0ZDQiLCJzZWNvbmRhcnlCdG5CZyI6IiM0NzQ2NDYiLCJzZWNvbmRhcnlCdG5CZ0hvdmVyIjoiI2NkNjgwMSIsInNlY29uZGFyeUJ0blRleHQiOiIjZDRkNGQ0Iiwic2Vjb25kYXJ5QnRuT3V0bGluZSI6IiMwYTBhMGEiLCJidG5Gb250V2VpZ2h0Ijo5MDAsImNoYWluQnRuQmciOiIjMDAwMDAwIiwiY2hhaW5CdG5CZ0FjdGl2ZSI6IiMwYzBiMGIiLCJjaGFpbkJ0blBhZGRpbmciOiIyMCJ9',
  modalBg: "#000000",
  chartBg: "#000000",
  borderColor: "#000000",
  tooltipBg: "#000000",
  formControlBg: "#020202",
  controlBorder: "#747474",
  primary: "#000000",
  secondary: "#474646",
  success: "#006407",
  error: "#cd0101",
  warning: "#e4e703",
  fontColor: "#8f8f8f",
  fontFamily: "Audiowide",
  theme: "dark",
  isHideLogo: false,
  logo: "",

  // NEW: your referral code logic + affiliateFee data
  r: getReferralKey(1),            // e.g. using chainId 1 (Ethereum) by default
  affiliateFeeRecipient: getAffiliateFeeRecipient(1),
  affiliateFeePercent: "1",
  jupiterRefLink: JUPITER_REFERRAL_LINK,
  jupiterRefPubkey: JUPITER_REFERRAL_PUBKEY,

  // The rest of your chain data
  supportedChains: JSON.stringify({
    inputChains: {
      1: [
        "",
        "0xdac17f958d2ee523a2206206994597c13d831ec7",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x6b175474e89094c44da98b954eedeac495271d0f",
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      ],
      10: [
        "",
        "0x4200000000000000000000000000000000000042",
        "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
        "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
        "0x4200000000000000000000000000000000000006",
      ],
      56: [
        "",
        "0x55d398326f99059ff775485246999027b3197955",
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      ],
      137: [
        "",
        "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
        "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
        "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      ],
      8453: [
        "",
        "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
        "0x4200000000000000000000000000000000000006",
        "0x506beb7965fc7053059006c7ab4c62c02c2d989f",
      ],
      42161: [
        "",
        "0x912ce59144191c1204e64559fe8253a0e49e6548",
        "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
      ],
      43114: [
        "",
        "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        "0xd586e7f844cea2f87f50152665bcbc2c279d8d70",
        "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
      ],
      7565164: [
        "",
        "So11111111111111111111111111111111111111112",
        "HAqD46mR4LgY3aJiMZSabfefZoysG3Uuj6wn2ZKYE14v",
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ],
    },
    outputChains: {
      1: [
        "",
        "0xdac17f958d2ee523a2206206994597c13d831ec7",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x6b175474e89094c44da98b954eedeac495271d0f",
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      ],
      10: [
        "",
        "0x4200000000000000000000000000000000000042",
        "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
        "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
        "0x4200000000000000000000000000000000000006",
      ],
      56: [
        "",
        "0x55d398326f99059ff775485246999027b3197955",
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",
        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      ],
      137: [
        "",
        "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
        "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
        "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      ],
      8453: [
        "",
        "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
        "0x4200000000000000000000000000000000000006",
        "0x506beb7965fc7053059006c7ab4c62c02c2d989f",
      ],
      42161: [
        "",
        "0x912ce59144191c1204e64559fe8253a0e49e6548",
        "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
      ],
      43114: [
        "",
        "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        "0xd586e7f844cea2f87f50152665bcbc2c279d8d70",
        "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
      ],
      7565164: [
        "",
        "So11111111111111111111111111111111111111112",
        "HAqD46mR4LgY3aJiMZSabfefZoysG3Uuj6wn2ZKYE14v",
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ],
    },
  }),
};

// ---------------------- Response Compression ----------------------
async function compressResponse(response: Response): Promise<Response> {
  const body = await response.text();
  const compressed = gzip(new TextEncoder().encode(body));
  
  const headers = new Headers(response.headers);
  headers.set('Content-Encoding', 'gzip');
  headers.set('Content-Length', compressed.length.toString());

  return new Response(compressed, {
    status: response.status,
    headers
  });
}

// ---------------------- Main Server Logic ----------------------
serve(async (req) => {
  const startTime = performance.now();
  const url = new URL(req.url);
  
  console.log(`Incoming request: ${req.method} ${url.pathname}`);
  console.log(`Current directory contents:`, await Deno.readDir(".").next());
  
  try {
    const clientIP = req.headers.get("x-forwarded-for")?.split(',')[0] || 
                    req.headers.get("x-real-ip") || 
                    "unknown";

    const rateLimitInfo = checkRateLimit(clientIP);
    
    if (!rateLimitInfo.allowed) {
      const headers = new Headers({
        "Content-Type": "text/plain",
        "Retry-After": Math.ceil((rateLimitInfo.reset - Date.now()) / 1000).toString(),
      });
      addRateLimitHeaders(headers, rateLimitInfo);
      
      return new Response("Rate limit exceeded", {
        status: 429,
        headers
      });
    }

    const url = new URL(req.url);
    const acceptsGzip = req.headers.get('accept-encoding')?.includes('gzip') ?? false;

    // Widget config endpoint
    if (url.pathname === "/widget-config") {
      try {
        const config = JSON.stringify(WIDGET_CONFIG);
        
        const headers = new Headers({
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${DYNAMIC_CACHE_MAX_AGE}`,
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        });
        addRateLimitHeaders(headers, rateLimitInfo);

        const response = new Response(config, { headers });
        return acceptsGzip ? await compressResponse(response) : response;
      } catch (configError) {
        console.error("Widget config error:", configError);
        throw configError;
      }
    }

    // Static file handling
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        const indexHtml = await Deno.readTextFile("widget-react-app/dist/index.html");
        const headers = new Headers({
          "content-type": "text/html; charset=utf-8",
          "Cache-Control": `public, max-age=${DYNAMIC_CACHE_MAX_AGE}`,
        });
        addRateLimitHeaders(headers, rateLimitInfo);
        return new Response(indexHtml, { headers });
      } catch (error) {
        console.error("Error serving index.html:", error);
        return new Response("Server Error", { status: 500 });
      }
    }

    // Static assets handling
    if (url.pathname.startsWith("/assets/") || url.pathname.match(/\.(ico|png|svg|webmanifest)$/)) {
      try {
        const response = await serveDir(req, {
          fsRoot: "widget-react-app/dist",
          urlRoot: "",
          quiet: false,
        });

        if (!response.ok) {
          console.error(`Failed to serve: ${url.pathname}`);
          return new Response("Not Found", { status: 404 });
        }

        response.headers.set("Cache-Control", 
          url.pathname.startsWith('/assets/') 
            ? `public, max-age=${STATIC_CACHE_MAX_AGE}`
            : `public, max-age=${DYNAMIC_CACHE_MAX_AGE}`
        );
        addRateLimitHeaders(response.headers, rateLimitInfo);

        return acceptsGzip ? await compressResponse(response) : response;
      } catch (error) {
        console.error(`Error serving static file ${url.pathname}:`, error);
        return new Response("Server Error", { status: 500 });
      }
    }

    // 404 handling
    const headers = new Headers({
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store'
    });
    addRateLimitHeaders(headers, rateLimitInfo);

    return new Response("Not Found", { 
      status: 404,
      headers
    });

  } catch (error) {
    console.error(`Error processing request to ${req.url}:`, error);
    const duration = performance.now() - startTime;
    if (duration > 1000) {
      console.warn(`Slow request to ${req.url}: ${duration.toFixed(2)}ms`);
    }
    
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store'
      }
    });
  }
});