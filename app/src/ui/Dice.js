import { jsx as _jsx } from "react/jsx-runtime";
export function Dice({ value, delay = 0 }) {
    const pips = Array.from({ length: value });
    return (_jsx("div", { className: "die", style: { animationDelay: `${delay}ms` }, children: pips.map((_, i) => (_jsx("span", { className: "pip" }, i))) }));
}
