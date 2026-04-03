import { NextRequest, NextResponse } from 'next/server';
import { getBillingProduct } from '@/lib/billing/catalog';
import { getStripeServerClient } from '@/lib/stripe';
import { getSupabaseServerClient } from '@/lib/supabase/server';

type CheckoutBody = {
  productId: string;
};

function getBaseUrl(req: NextRequest) {
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckoutBody;
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 });
    }

    const supabase = getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const product = getBillingProduct(body.productId);
    if (!product) {
      return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
    }

    const stripe = getStripeServerClient();
    const origin = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${origin}/api/stripe/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      customer_email: user.email ?? undefined,
      payment_method_types: ['card', 'alipay', 'wechat_pay'],
      payment_method_options: {
        wechat_pay: {
          client: 'web',
        },
      },
      allow_promotion_codes: true,
      metadata: {
        userId: user.id,
        productId: product.id,
        kind: product.kind,
        billingCycle: product.kind === 'pro_pass' ? product.billingCycle : '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: product.currency,
            unit_amount: product.unitAmount,
            product_data: {
              name: product.name,
              description: product.description,
            },
          },
        },
      ],
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
