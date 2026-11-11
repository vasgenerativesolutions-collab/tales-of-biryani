// supabase/functions/razorpay-webhook/index.ts
// Edge Function: Handles Razorpay webhook events (payment.captured, payment.failed).
// This is the SOURCE OF TRUTH for payment status — idempotent.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();

    // Verify webhook signature
    const receivedSignature = req.headers.get("x-razorpay-signature");
    if (!receivedSignature) {
      return new Response("Missing signature", { status: 400 });
    }

    const key = new TextEncoder().encode(RAZORPAY_WEBHOOK_SECRET);
    const data = new TextEncoder().encode(rawBody);

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

    if (expectedSignature !== receivedSignature) {
      console.error("Webhook signature mismatch");
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment.entity;
        const rzpOrderId = payment.order_id;
        const rzpPaymentId = payment.id;

        // Idempotent: only update if not already captured
        const { data: existing } = await supabase
          .from("payments")
          .select("status")
          .eq("razorpay_order_id", rzpOrderId)
          .single();

        if (existing?.status === "captured") {
          // Already processed — idempotent
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        // Update payment
        await supabase
          .from("payments")
          .update({
            razorpay_payment_id: rzpPaymentId,
            status: "captured",
            raw: payment,
          })
          .eq("razorpay_order_id", rzpOrderId);

        // Update order status
        await supabase
          .from("orders")
          .update({
            status: "placed",
            updated_at: new Date().toISOString(),
          })
          .eq("razorpay_order_id", rzpOrderId)
          .eq("status", "pending"); // only if still pending

        // Also check reservations
        await supabase
          .from("reservations")
          .update({
            deposit_paid: true,
            status: "confirmed",
          })
          .eq("razorpay_order_id", rzpOrderId)
          .eq("status", "pending");

        console.log(`Payment captured: ${rzpPaymentId} for order ${rzpOrderId}`);
        break;
      }

      case "payment.failed": {
        const payment = event.payload.payment.entity;
        const rzpOrderId = payment.order_id;

        await supabase
          .from("payments")
          .update({
            status: "failed",
            raw: payment,
          })
          .eq("razorpay_order_id", rzpOrderId);

        console.log(`Payment failed for order ${rzpOrderId}`);
        break;
      }

      case "refund.created":
      case "refund.processed": {
        // Refund hook stub — log for now
        const refund = event.payload.refund.entity;
        console.log(`Refund ${event.event}: ${refund.id}, amount: ${refund.amount}`);

        // TODO: Update payment status to 'refunded', notify user
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    // Return 200 to prevent Razorpay from retrying on our errors
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
