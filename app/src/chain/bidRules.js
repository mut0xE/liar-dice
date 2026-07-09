export function validateBid(prev, next) {
    if (!Number.isInteger(next.face) || next.face < 1 || next.face > 6)
        return { ok: false, reason: "Face must be 1–6" };
    if (!Number.isInteger(next.quantity) || next.quantity < 1)
        return { ok: false, reason: "Quantity must be at least 1" };
    if (prev === null)
        return { ok: true };
    if (next.quantity > prev.quantity)
        return { ok: true };
    if (next.quantity === prev.quantity && next.face > prev.face)
        return { ok: true };
    return { ok: false, reason: "Bid must raise quantity or face" };
}
