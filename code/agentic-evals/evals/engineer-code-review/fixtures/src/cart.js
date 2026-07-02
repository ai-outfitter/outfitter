import { applyGuestDiscount, applyMemberDiscount } from './discounts.js';

export function createCart(items = []) {
  return { items, coupon: null };
}

export function addItem(cart, item) {
  cart.items.push(item);
  return cart;
}

export function checkoutTotalCents(cart, customer) {
  if (customer.isMember) {
    return applyMemberDiscount(cart);
  }
  return applyGuestDiscount(cart);
}
