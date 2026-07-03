const MEMBER_DISCOUNT = 0.15;
const GUEST_DISCOUNT = 0.05;

export function applyMemberDiscount(cart) {
  let total = 0;
  for (const item of cart.items) {
    total += item.unitPriceCents * item.quantity;
  }
  if (cart.coupon && cart.coupon.active) {
    total -= cart.coupon.amountCents;
  }
  const discounted = total * (1 - MEMBER_DISCOUNT);
  return Math.round(discounted);
}

export function applyGuestDiscount(cart) {
  let total = 0;
  for (const item of cart.items) {
    total += item.unitPriceCents * item.quantity;
  }
  if (cart.coupon && cart.coupon.active) {
    total -= cart.coupon.amountCents;
  }
  const discounted = total * (1 - GUEST_DISCOUNT);
  return Math.floor(discounted);
}

export function describeDiscount(kind) {
  if (kind == 'member') {
    return `${MEMBER_DISCOUNT * 100}% member discount`;
  }
  return `${GUEST_DISCOUNT * 100}% guest discount`;
}
