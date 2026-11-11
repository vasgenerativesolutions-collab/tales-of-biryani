// supabase/functions/create-order/index.ts
// Edge Function: Validates cart server-side, recomputes totals,
// creates a Razorpay order, saves it as 'pending', returns order details.
//
// NEVER expose Razorpay secret to the client.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;

const GST_RATE = 0.05; // 5% GST on restaurant food
const DELIVERY_FEE_PAISE = 4900; // ₹49 delivery fee

interface CartItem {
  item_id: string;
  variant_id?: string;
  qty: number;
}

interface CreateOrderRequest {
  items: CartItem[];
  type: "delivery" | "pickup";
  address_id?: string; // required for delivery
  outlet_id: string;
  coupon_code?: string;
  notes?: string;
}

serve(async (req: Request) => {
  // CORS
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
    // Authenticate the user via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("Missing authorization", 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the user's JWT to get their Firebase UID
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const userId = user.id; // Firebase UID via third-party auth

    const body: CreateOrderRequest = await req.json();

    // Validate request
    if (!body.items || body.items.length === 0) {
      return jsonError("Cart is empty", 400);
    }
    if (!body.outlet_id) {
      return jsonError("Outlet is required", 400);
    }
    if (body.type === "delivery" && !body.address_id) {
      return jsonError("Address is required for delivery", 400);
    }

    // Fetch all items and variants from DB (source of truth for prices)
    const itemIds = body.items.map((i) => i.item_id);
    const variantIds = body.items
      .filter((i) => i.variant_id)
      .map((i) => i.variant_id!);

    const { data: menuItems, error: menuErr } = await supabase
      .from("menu_items")
      .select("id, name, base_price, is_available")
      .in_("id", itemIds);

    if (menuErr) throw menuErr;

    const { data: variants, error: varErr } = variantIds.length > 0
      ? await supabase
          .from("menu_variants")
          .select("id, item_id, label, price_delta")
          .in_("id", variantIds)
      : { data: [], error: null };

    if (varErr) throw varErr;

    // Build price map
    const itemMap = new Map(menuItems?.map((i) => [i.id, i]) ?? []);
    const variantMap = new Map(variants?.map((v) => [v.id, v]) ?? []);

    // Compute line items with server-verified prices
    let subtotal = 0;
    const orderItems: Array<{
      item_id: string;
      variant_id: string | null;
      qty: number;
      unit_price: number;
    }> = [];

    for (const cartItem of body.items) {
      const item = itemMap.get(cartItem.item_id);
      if (!item) {
        return jsonError(`Item ${cartItem.item_id} not found`, 400);
      }
      if (!item.is_available) {
        return jsonError(`${item.name} is currently unavailable`, 400);
      }

      let unitPrice = item.base_price;
      if (cartItem.variant_id) {
        const variant = variantMap.get(cartItem.variant_id);
        if (!variant || variant.item_id !== cartItem.item_id) {
          return jsonError(`Invalid variant for ${item.name}`, 400);
        }
        unitPrice += variant.price_delta;
      }

      const qty = Math.max(1, Math.min(cartItem.qty, 20)); // cap qty
      subtotal += unitPrice * qty;

      orderItems.push({
        item_id: cartItem.item_id,
        variant_id: cartItem.variant_id ?? null,
        qty,
        unit_price: unitPrice,
      });
    }

    // Compute totals
    const tax = Math.round(subtotal * GST_RATE);
    const deliveryFee = body.type === "delivery" ? DELIVERY_FEE_PAISE : 0;
    const discount = 0; // TODO: coupon validation
    const total = subtotal + tax + deliveryFee - discount;

    if (total <= 0) {
      return jsonError("Invalid order total", 400);
    }

    // Create Razorpay order
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`),
      },
      body: JSON.stringify({
        amount: total, // in paise
        currency: "INR",
        receipt: `tob_${Date.now()}`,
        notes: {
          user_id: userId,
          type: body.type,
        },
      }),
    });

    if (!rzpRes.ok) {
      const rzpErr = await rzpRes.text();
      console.error("Razorpay error:", rzpErr);
      return jsonError("Payment gateway error", 502);
    }

    const rzpOrder = await rzpRes.json();

    // Save order to Supabase
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        type: body.type,
        status: "pending",
        subtotal,
        tax,
        delivery_fee: deliveryFee,
        discount,
        total,
        address_id: body.address_id ?? null,
        outlet_id: body.outlet_id,
        coupon_code: body.coupon_code ?? null,
        notes: body.notes ?? null,
        razorpay_order_id: rzpOrder.id,
      })
      .select("id")
      .single();

    if (orderErr) throw orderErr;

    // Save order items
    const items = orderItems.map((oi) => ({
      order_id: order.id,
      ...oi,
    }));

    const { error: itemsErr } = await supabase
      .from("order_items")
      .insert(items);

    if (itemsErr) throw itemsErr;

    // Create payment record
    await supabase.from("payments").insert({
      order_id: order.id,
      razorpay_order_id: rzpOrder.id,
      amount: total,
      status: "created",
    });

    return new Response(
      JSON.stringify({
        order_id: order.id,
        razorpay_order_id: rzpOrder.id,
        razorpay_key_id: RAZORPAY_KEY_ID,
        amount: total,
        currency: "INR",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("create-order error:", err);
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
