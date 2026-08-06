/**
 * render-constants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all visual configuration in the rendering system.
 */

'use strict';

// ─── Road Visual Configuration ────────────────────────────────────────────────

const ROAD_STYLE = {
  major: {
    surfaceColour:   '#2a2a3e',
    casingColour:    '#14142a',
    shadowColour:    'rgba(0,0,0,0.65)',
    markingColour:   'rgba(255,255,255,0.85)',
    centreColour:    'rgba(255,210,40,0.90)',
    casingWidthM:    1.2,
    shadowWidthM:    2.5,
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      true,
    drawCentreLine:  true,
    zOrder:          40,
  },
  arterial: {
    surfaceColour:   '#242438',
    casingColour:    '#14142a',
    shadowColour:    'rgba(0,0,0,0.55)',
    markingColour:   'rgba(255,255,255,0.75)',
    centreColour:    'rgba(255,210,40,0.80)',
    casingWidthM:    1.0,
    shadowWidthM:    2.0,
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      true,
    drawCentreLine:  true,
    zOrder:          35,
  },
  collector: {
    surfaceColour:   '#202036',
    casingColour:    '#121228',
    shadowColour:    'rgba(0,0,0,0.40)',
    markingColour:   'rgba(255,255,255,0.60)',
    centreColour:    'rgba(255,210,40,0.65)',
    casingWidthM:    0.8,
    shadowWidthM:    1.5,
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      false,
    drawCentreLine:  true,
    zOrder:          30,
  },
  local: {
    surfaceColour:   '#1c1c30',
    casingColour:    '#10102a',
    shadowColour:    'rgba(0,0,0,0.30)',
    markingColour:   'rgba(255,255,255,0.45)',
    centreColour:    'rgba(255,210,40,0.50)',
    casingWidthM:    0.5,
    shadowWidthM:    1.0,
    drawCasing:      true,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          20,
  },
  service: {
    surfaceColour:   '#181826',
    casingColour:    '#0e0e1e',
    shadowColour:    'rgba(0,0,0,0.20)',
    markingColour:   'rgba(200,200,200,0.25)',
    centreColour:    'rgba(200,200,200,0.25)',
    casingWidthM:    0.3,
    shadowWidthM:    0.5,
    drawCasing:      false,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          10,
  },
  path: {
    surfaceColour:   '#182018',
    casingColour:    '#101a10',
    shadowColour:    'rgba(0,0,0,0.15)',
    markingColour:   'rgba(140,200,140,0.30)',
    centreColour:    'rgba(140,200,140,0.30)',
    casingWidthM:    0.2,
    shadowWidthM:    0.3,
    drawCasing:      false,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          5,
  },
};

// ─── Vehicle Visual Configuration ────────────────────────────────────────────

/**
 * Physical dimensions and colours per vehicle type.
 * Vehicles are sized larger so they're clearly visible even at default zoom.
 * Multiple colour variants per common type are handled by VEHICLE_COLOUR_VARIANTS.
 */
const VEHICLE_STYLE = {
  car: {
    colour:          '#4a90d9',
    emergencyColour: '#ff3b30',
    widthM:          2.4,
    lengthM:         5.5,
    wheelbaseRatio:  0.6,
    zOrder:          60,
  },
  bus: {
    colour:          '#ffd60a',
    emergencyColour: '#ffd60a',
    widthM:          3.2,
    lengthM:         14.0,
    wheelbaseRatio:  0.75,
    zOrder:          58,
  },
  truck: {
    colour:          '#bf5af2',
    emergencyColour: '#bf5af2',
    widthM:          3.0,
    lengthM:         10.0,
    wheelbaseRatio:  0.65,
    zOrder:          57,
  },
  cyclist: {
    colour:          '#34c759',
    emergencyColour: '#34c759',
    widthM:          1.0,
    lengthM:         2.2,
    wheelbaseRatio:  0.6,
    zOrder:          55,
  },
  pedestrian: {
    colour:          '#ff9f0a',
    emergencyColour: '#ff9f0a',
    widthM:          0.8,
    lengthM:         0.8,
    wheelbaseRatio:  0.0,
    zOrder:          54,
  },
  motorcycle: {
    colour:          '#30d158',
    emergencyColour: '#30d158',
    widthM:          1.2,
    lengthM:         2.8,
    wheelbaseRatio:  0.6,
    zOrder:          56,
  },
  parked: {
    colour:          '#636366',
    emergencyColour: '#636366',
    widthM:          2.4,
    lengthM:         5.5,
    wheelbaseRatio:  0.6,
    zOrder:          45,
  },
  emergency: {
    colour:          '#ff3b30',
    emergencyColour: '#ff3b30',
    widthM:          2.8,
    lengthM:         6.5,
    wheelbaseRatio:  0.62,
    zOrder:          70,
  },
  default: {
    colour:          '#48484a',
    emergencyColour: '#ff3b30',
    widthM:          2.4,
    lengthM:         5.5,
    wheelbaseRatio:  0.6,
    zOrder:          50,
  },
};

/**
 * Colour palette for car colour variation.
 * Vehicles cycle through these based on their uid hash so each car
 * has a stable, distinct colour across frames.
 */
const VEHICLE_COLOUR_VARIANTS = [
  '#4a90d9',   // blue
  '#5ac8fa',   // light blue
  '#34c759',   // green
  '#30d158',   // mint
  '#ffd60a',   // yellow
  '#ff9f0a',   // orange
  '#bf5af2',   // purple
  '#64d2ff',   // cyan
  '#ff6b6b',   // coral
  '#a8ff78',   // lime
];

// ─── Traffic Signal Configuration ────────────────────────────────────────────

const SIGNAL_STYLE = {
  housingColour:    '#1a1a22',
  housingStroke:    '#2e2e3c',
  housingPadding:   0.15,
  glowMultiplier:   3.0,

  phases: {
    GREEN:  {
      activeColour:  '#32d74b',
      glowColour:    '#32d74b',
      inactiveColour:'#0a2a12',
    },
    YELLOW: {
      activeColour:  '#ffd60a',
      glowColour:    '#ffd60a',
      inactiveColour:'#3a2e00',
    },
    RED:    {
      activeColour:  '#ff453a',
      glowColour:    '#ff453a',
      inactiveColour:'#3a1010',
    },
  },

  defaultState: 'RED',
};

// ─── Sidewalk Configuration ───────────────────────────────────────────────────

const SIDEWALK_STYLE = {
  colour:       'rgba(160,160,180,0.28)',
  strokeColour: 'rgba(160,160,180,0.12)',
  minWidthPx:   1.0,
};

// ─── Crosswalk Configuration ──────────────────────────────────────────────────

const CROSSWALK_STYLE = {
  stripeColour:     'rgba(255,255,255,0.72)',
  stripeWidthM:     0.5,
  stripeGapM:       0.5,
  crosswalkWidthFr: 0.85,
};

// ─── Zoom Thresholds ──────────────────────────────────────────────────────────

const ZOOM_THRESHOLDS = {
  vehicleLabels: 3.5,
  laneMarkings:  0.4,
  centreLine:    0.3,
};

// ─── Scale Limits ─────────────────────────────────────────────────────────────

const MIN_SCALE = 0.05;
const MAX_SCALE = 50.0;

// ─── Bundled export ───────────────────────────────────────────────────────────

const RENDER_CONSTANTS = {
  ROAD_STYLE,
  VEHICLE_STYLE,
  VEHICLE_COLOUR_VARIANTS,
  SIGNAL_STYLE,
  SIDEWALK_STYLE,
  CROSSWALK_STYLE,
  ZOOM_THRESHOLDS,
  MIN_SCALE,
  MAX_SCALE,
};

window.RENDER_CONSTANTS  = RENDER_CONSTANTS;
window.ROAD_STYLE        = ROAD_STYLE;
window.VEHICLE_STYLE     = VEHICLE_STYLE;
window.VEHICLE_COLOUR_VARIANTS = VEHICLE_COLOUR_VARIANTS;
window.SIGNAL_STYLE      = SIGNAL_STYLE;
window.SIDEWALK_STYLE    = SIDEWALK_STYLE;
window.CROSSWALK_STYLE   = CROSSWALK_STYLE;
window.ZOOM_THRESHOLDS   = ZOOM_THRESHOLDS;
window.MIN_SCALE         = MIN_SCALE;
window.MAX_SCALE         = MAX_SCALE;

console.info('[RenderConstants] loaded');