/**
 * colour.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Colour manipulation utilities for the rendering system.
 *
 * All functions are pure. No state, no side effects.
 * All colour values are strings compatible with Canvas 2D fillStyle/strokeStyle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Constructs an RGBA colour string.
 *
 * @param {number} r - red   [0, 255]
 * @param {number} g - green [0, 255]
 * @param {number} b - blue  [0, 255]
 * @param {number} [a=1] - alpha [0, 1]
 * @returns {string} e.g. 'rgba(255, 128, 0, 0.5)'
 */
function rgba(r, g, b, a = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

/**
 * Constructs an HSLA colour string.
 *
 * @param {number} h - hue        [0, 360]
 * @param {number} s - saturation [0, 100]
 * @param {number} l - lightness  [0, 100]
 * @param {number} [a=1] - alpha  [0, 1]
 * @returns {string}
 */
function hsla(h, s, l, a = 1) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

/**
 * Returns the same colour with a different alpha value.
 * Input must be an rgba() or hex string.
 *
 * For hex inputs, converts to rgba first.
 *
 * @param {string} colour - CSS colour string
 * @param {number} alpha  - new alpha [0, 1]
 * @returns {string}
 */
function withAlpha(colour, alpha) {
  // Handle rgba() format
  const rgbaMatch = colour.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbaMatch) {
    return rgba(
      parseInt(rgbaMatch[1]),
      parseInt(rgbaMatch[2]),
      parseInt(rgbaMatch[3]),
      alpha
    );
  }

  // Handle hex format (#rrggbb or #rgb)
  const hex = hexToRgb(colour);
  if (hex) return rgba(hex.r, hex.g, hex.b, alpha);

  // Fallback: return as-is
  return colour;
}

/**
 * Parses a hex colour string to RGB components.
 *
 * @param {string} hex - '#rrggbb' or '#rgb'
 * @returns {{ r: number, g: number, b: number } | null}
 */
function hexToRgb(hex) {
  const clean = hex.replace('#', '');

  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }

  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  return null;
}

/**
 * Linearly interpolates between two hex colours.
 * Returns an rgba() string.
 *
 * @param {string} hexA - start colour
 * @param {string} hexB - end colour
 * @param {number} t    - interpolation factor [0, 1]
 * @returns {string}
 */
function lerpColour(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA;

  return rgba(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  );
}

// ── Global registration ───────────────────────────────────────────────────────
window.ColourUtils = {
    rgba,
    hsla,
    withAlpha,
    hexToRgb,
    lerpColour,
};
