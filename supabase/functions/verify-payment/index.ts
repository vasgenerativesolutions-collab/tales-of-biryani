// supabase/functions/verify-payment/index.ts
// Edge Function: Verifies Razorpay payment signature (HMAC SHA256),
// then marks the order as 'placed' (paid).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;

interface VerifyRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  order_id: string; // our internal order ID
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("Unauthorized", 401);
    }

    const body: VerifyRequest = await req.json();

    // Verify HMAC SHA256 signature
    // signature = HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, secret)
    const message = `${body.razorpay_order_id}|${body.razorpay_payment_id}`;

    const key = new TextEncoder().encode(RAZORPAY_KEY_SECRET);
    const data = new TextEncoder().encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);
    const expectedSignature = new TextDecoder().decode(
      encode(new Uint8Array(signatureBuffer))
    );

    if (expectedSignature !== body.razorpay_signature) {
      console.error("Signature mismatch");
      return jsonError("Payment verification failed", 400);
    }

    // Signature valid — update order and payment
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update payment record
    const { error: payErr } = await supabase
      .from("payments")
      .update({
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_signature: body.razorpay_signature,
        status: "captured",
      })
      .eq("order_id", body.order_id)
      .eq("razorpay_order_id", body.razorpay_order_id);

    if (payErr) throw payErr;

    // Update order status to 'placed'
    const { error: orderErr } = await supabase
      .from("orders")
      .update({
        status: "placed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.order_id)
      .eq("razorpay_order_id", body.razorpay_order_id);

    if (orderErr) throw orderErr;

    return new Response(
      JSON.stringify({ success: true, order_id: body.order_id }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("verify-payment error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
